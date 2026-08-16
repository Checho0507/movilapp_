import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, subscriptionsTable, SUBSCRIPTION_PLANS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate, signToken } from "../lib/auth.js";

const router = Router();

const VALID_PAYMENT_METHODS = ["nequi", "daviplata", "breve"] as const;
type DigitalPayment = typeof VALID_PAYMENT_METHODS[number];

function normalizePhone(phone: string): string {
  // Strip all non-digit characters so we normalize formats like +57 300-123-4567, (300) 123 4567, etc.
  const digits = (phone ?? "").toString().replace(/\D+/g, "");
  return digits;
}

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

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    res.status(400).json({ error: "Invalid phone number" });
    return;
  }

  // Basic password strength check
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters long' });
    return;
  }

  // Normalize email if provided
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : null;

  const existing = await db.select().from(usersTable).where(eq(usersTable.phone, normalizedPhone)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Phone number already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const [user] = await db
      .insert(usersTable)
      .values({
        name,
        phone: normalizedPhone,
        email: normalizedEmail ?? null,
        passwordHash,
        role,
        acceptedPayments: sanitizedPayments,
      })
      .returning();

    // NOTE: Drivers do NOT receive a trial here.
    // The 60-day trial is granted when they register their first vehicle (POST /api/vehicles).
    // This ties trial eligibility to the vehicle plate — not the phone number —
    // preventing drivers from creating new accounts to reset the trial.

    const token = signToken({ userId: user.id, role: user.role });
    res.status(201).json({ token, user: formatUser(user) });
  } catch (err) {
    // Handle unique constraint race (Postgres 23505) or other DB errors
    const pgErrCode = (err && (err.code || err.errno)) as unknown as string;
    if (pgErrCode === "23505" || /duplicate/i.test(String(err))) {
      res.status(409).json({ error: "Phone number already registered" });
      return;
    }
    console.error('DB error on user insert', err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { phone, password } = req.body as { phone: string; password: string };

  if (!phone || !password) {
    res.status(400).json({ error: "phone and password are required" });
    return;
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    res.status(400).json({ error: "phone and password are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, normalizedPhone)).limit(1);
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
    // Use 403 to indicate the account is explicitly blocked
    res.status(403).json({ error: "Account is blocked" });
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
