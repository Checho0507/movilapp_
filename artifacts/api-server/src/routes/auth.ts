import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, subscriptionsTable, SUBSCRIPTION_PLANS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate, signToken } from "../lib/auth.js";

const router = Router();

const VALID_PAYMENT_METHODS = ["nequi", "daviplata", "breve"] as const;
type DigitalPayment = typeof VALID_PAYMENT_METHODS[number];

function formatUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    isOnline: u.isOnline,
    currentLat: u.currentLat != null ? Number(u.currentLat) : null,
    currentLng: u.currentLng != null ? Number(u.currentLng) : null,
    rating: Number(u.rating),
    ratingCount: u.ratingCount,
    acceptedPayments: (u.acceptedPayments ?? []) as DigitalPayment[],
    createdAt: u.createdAt.toISOString(),
  };
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { name, phone, password, role, email, acceptedPayments } = req.body as {
    name: string;
    phone: string;
    password: string;
    role: string;
    email?: string | null;
    acceptedPayments?: string[];
  };

  if (!name || !phone || !password || !role) {
    res.status(400).json({ error: "name, phone, password and role are required" });
    return;
  }
  if (!["passenger", "driver"].includes(role)) {
    res.status(400).json({ error: "role must be passenger or driver" });
    return;
  }

  // Validate and sanitize accepted payment methods (drivers only)
  const sanitizedPayments: string[] = role === "driver"
    ? (acceptedPayments ?? []).filter((m): m is string => VALID_PAYMENT_METHODS.includes(m as DigitalPayment))
    : [];

  const existing = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (existing.length > 0) {
    res.status(400).json({ error: "Phone number already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(usersTable)
    .values({
      name,
      phone,
      email: email ?? null,
      passwordHash,
      role,
      acceptedPayments: sanitizedPayments,
    })
    .returning();

  // Grant 60-day free trial for drivers
  if (role === "driver") {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SUBSCRIPTION_PLANS.trial.days * 24 * 60 * 60 * 1000);
    await db.insert(subscriptionsTable).values({
      driverId: user.id,
      plan: "trial",
      priceCop: 0,
      startsAt: now,
      expiresAt,
      isTrial: true,
    });
  }

  const token = signToken({ userId: user.id, role: user.role });
  res.status(201).json({ token, user: formatUser(user) });
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { phone, password } = req.body as { phone: string; password: string };

  if (!phone || !password) {
    res.status(400).json({ error: "phone and password are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (!user.isActive) {
    res.status(401).json({ error: "Account is blocked" });
    return;
  }

  const token = signToken({ userId: user.id, role: user.role });
  res.json({ token, user: formatUser(user) });
});

// GET /api/auth/me
router.get("/me", authenticate, async (req, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

export default router;
export { formatUser };
