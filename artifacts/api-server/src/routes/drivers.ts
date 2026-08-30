import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, vehiclesTable, tripsTable, subscriptionsTable, SUBSCRIPTION_PLANS } from "@workspace/db";
import { eq, and, sql, or, inArray, desc } from "drizzle-orm";
import { authenticate, requireRole } from "../lib/auth.js";
import { formatUser } from "./auth.js";
import type { Server as IOServer } from "socket.io";

const router = Router();

const VALID_PAYMENT_METHODS = ["nequi", "daviplata", "breve"] as const;
const VALID_RENEWAL_PLANS = ["daily", "weekly", "biweekly", "monthly"] as const;
const VALID_RENEWAL_PAYMENT_METHODS = ["pse", "tarjeta", "nequi", "daviplata"] as const;

export function normalizeRenewalRequest(input: { plan?: string; paymentMethod?: string }) {
  const plan = typeof input.plan === "string" ? input.plan.trim().toLowerCase() : "";
  const paymentMethod = typeof input.paymentMethod === "string" ? input.paymentMethod.trim().toLowerCase() : "";

  const isPlanValid = (VALID_RENEWAL_PLANS as readonly string[]).includes(plan);
  const isPaymentValid = (VALID_RENEWAL_PAYMENT_METHODS as readonly string[]).includes(paymentMethod);

  return {
    plan,
    paymentMethod,
    isPlanValid,
    isPaymentValid,
    planData: isPlanValid ? (SUBSCRIPTION_PLANS as Record<string, any>)[plan] : null,
  };
}

async function ensureDriverHasStarterSubscription(driverId: number) {
  const [existing] = await db
    .select({ id: subscriptionsTable.id, expiresAt: subscriptionsTable.expiresAt })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.driverId, driverId))
    .orderBy(subscriptionsTable.expiresAt)
    .limit(1);

  if (existing) return existing;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const [subscription] = await db
    .insert(subscriptionsTable)
    .values({
      driverId,
      plan: "trial",
      priceCop: 0,
      startsAt: now,
      expiresAt,
      isTrial: true,
    })
    .returning();

  return subscription;
}

let io: IOServer | null = null;
export function setIO(ioInstance: IOServer) {
  io = ioInstance;
}

// PATCH /api/drivers/status
router.patch("/status", authenticate, requireRole("driver"), async (req, res) => {
  const { isOnline } = req.body as { isOnline: boolean };
  const driverId = req.user!.userId;

  // Allow a brand-new driver to get a starter trial automatically, but still block expired subscriptions.
  if (isOnline) {
    const [activeSub] = await db
      .select({ id: subscriptionsTable.id, expiresAt: subscriptionsTable.expiresAt })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.driverId, driverId))
      .orderBy(subscriptionsTable.expiresAt)
      .limit(1);

    if (!activeSub) {
      await ensureDriverHasStarterSubscription(driverId);
    }

    const [validatedSub] = await db
      .select({ id: subscriptionsTable.id, expiresAt: subscriptionsTable.expiresAt })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.driverId, driverId))
      .orderBy(subscriptionsTable.expiresAt)
      .limit(1);

    if (!validatedSub || new Date(validatedSub.expiresAt).getTime() <= Date.now()) {
      res.status(403).json({
        error: "Tu suscripción ha vencido. Contacta al administrador para renovar tu plan.",
        code: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }
  }

  const [user] = await db
    .update(usersTable)
    .set({ isOnline })
    .where(eq(usersTable.id, req.user!.userId))
    .returning();

  io?.emit("driver_status_changed", { driverId: user.id, isOnline });

  res.json(formatUser(user));
});

// PATCH /api/drivers/location
router.patch("/location", authenticate, requireRole("driver"), async (req, res) => {
  const { lat, lng } = req.body as { lat: number; lng: number };
  const driverId = req.user!.userId;

  const [user] = await db
    .update(usersTable)
    .set({ currentLat: String(lat), currentLng: String(lng) })
    .where(eq(usersTable.id, req.user!.userId))
    .returning();

  const locationPayload = {
    driverId: user.id,
    lat: Number(user.currentLat),
    lng: Number(user.currentLng),
  };

  // Broadcast to passengers subscribed to this driver's movements
  io?.to(`driver:${user.id}`).emit("driver_location_updated", locationPayload);
  io?.to(`driver:${user.id}`).emit("driver:location", locationPayload);

  // Also broadcast to the driver's active trip room so the passenger on the trip detail screen receives it
  const [activeTrip] = await db
    .select({ id: tripsTable.id })
    .from(tripsTable)
    .where(
      and(
        eq(tripsTable.driverId, driverId),
        or(
          eq(tripsTable.status, "accepted"),
          eq(tripsTable.status, "driver_arriving"),
          eq(tripsTable.status, "in_progress"),
        ),
      )
    )
    .limit(1);

  if (activeTrip) {
    io?.to(`trip:${activeTrip.id}`).emit("driver:location", locationPayload);
  }

  res.json(formatUser(user));
});

// PATCH /api/drivers/payment-methods
// Drivers can update which digital payment methods they accept.
// Name and license plate changes require contacting admin for security.
router.patch("/payment-methods", authenticate, requireRole("driver"), async (req, res) => {
  const { acceptedPayments } = req.body as { acceptedPayments: string[] };

  if (!Array.isArray(acceptedPayments)) {
    res.status(400).json({ error: "acceptedPayments must be an array" });
    return;
  }

  const sanitized = acceptedPayments.filter(
    (m): m is string => VALID_PAYMENT_METHODS.includes(m as typeof VALID_PAYMENT_METHODS[number])
  );

  const [user] = await db
    .update(usersTable)
    .set({ acceptedPayments: sanitized })
    .where(eq(usersTable.id, req.user!.userId))
    .returning();

  res.json(formatUser(user));
});

// POST /api/drivers/panic
router.post("/panic", authenticate, requireRole("driver"), async (req, res) => {
  const [driver] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId))
    .limit(1);

  if (!driver) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const alert = {
    driverId: driver.id,
    driverName: driver.name,
    lat: driver.currentLat != null ? Number(driver.currentLat) : null,
    lng: driver.currentLng != null ? Number(driver.currentLng) : null,
    timestamp: new Date().toISOString(),
    message: `¡ALERTA DE PÁNICO! ${driver.name} necesita ayuda urgente.`,
    notifiedDrivers: 0,
  };

  // Notify all admins and drivers
  io?.emit("panic_alert", alert);

  res.json(alert);
});

// GET /api/drivers/nearby
router.get("/nearby", authenticate, async (req, res) => {
  const { lat, lng, vehicleType } = req.query as Record<string, string>;
  if (!lat || !lng) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }

  const latN = Number(lat);
  const lngN = Number(lng);
  const radiusKm = 10;
  const deltaLat = radiusKm / 111;
  const deltaLng = radiusKm / (111 * Math.cos((latN * Math.PI) / 180));

  const conditions = [
    eq(usersTable.role, "driver"),
    eq(usersTable.isOnline, true),
    eq(usersTable.isActive, true),
    sql`${usersTable.currentLat}::numeric BETWEEN ${latN - deltaLat} AND ${latN + deltaLat}`,
    sql`${usersTable.currentLng}::numeric BETWEEN ${lngN - deltaLng} AND ${lngN + deltaLng}`,
  ];

  const drivers = await db
    .select()
    .from(usersTable)
    .where(and(...conditions))
    .limit(30);

  // Optionally join with vehicles to get vehicleType
  const driverIds = drivers.map(d => d.id);
  const vehicles = driverIds.length > 0
    ? await db
        .select()
        .from(vehiclesTable)
        .where(
          vehicleType
            ? and(inArray(vehiclesTable.driverId, driverIds), eq(vehiclesTable.vehicleType, vehicleType))
            : inArray(vehiclesTable.driverId, driverIds)
        )
    : [];

  const vehicleMap = new Map<number, typeof vehiclesTable.$inferSelect>();
  for (const v of vehicles) vehicleMap.set(v.driverId, v);

  const result = drivers
    .filter(d => !vehicleType || vehicleMap.has(d.id))
    .map(d => ({
      id: d.id,
      name: d.name,
      lat: Number(d.currentLat),
      lng: Number(d.currentLng),
      rating: Number(d.rating),
      vehicleType: vehicleMap.get(d.id)?.vehicleType ?? null,
      acceptedPayments: d.acceptedPayments ?? [],
    }));

  res.json(result);
});

// POST /api/drivers/renew-subscription
router.post("/renew-subscription", authenticate, requireRole("driver"), async (req, res) => {
  const { plan, paymentMethod } = req.body as { plan?: string; paymentMethod?: string };
  const normalized = normalizeRenewalRequest({ plan, paymentMethod });

  if (!normalized.isPlanValid) {
    res.status(400).json({ error: "Plan de suscripción inválido." });
    return;
  }

  if (!normalized.isPaymentValid) {
    res.status(400).json({ error: "Método de pago inválido. Usa PSE, tarjeta, Nequi o Daviplata." });
    return;
  }

  const driverId = req.user!.userId;
  const [activeSub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.driverId, driverId))
    .orderBy(desc(subscriptionsTable.expiresAt))
    .limit(1);

  const now = new Date();
  if (activeSub) {
    const daysRemaining = Math.max(0, Math.ceil((activeSub.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    // Allow renewal only if subscription is expired or about to expire (<=5 days)
    if (daysRemaining > 5) {
      res.status(409).json({ error: "Tu suscripción actual aún está vigente. Puedes renovar cuando falten 5 días para vencer." });
      return;
    }
  }

  const planInfo = normalized.planData;
  const expiresAt = new Date(now.getTime() + planInfo.days * 24 * 60 * 60 * 1000);

  const [subscription] = await db
    .insert(subscriptionsTable)
    .values({
      driverId,
      plan: normalized.plan,
      priceCop: planInfo.priceCop,
      startsAt: now,
      expiresAt,
      isTrial: false,
      createdById: driverId,
      notes: `Pago en línea: ${normalized.paymentMethod}`,
    })
    .returning();

  res.status(201).json({
    id: subscription.id,
    plan: subscription.plan,
    planLabel: SUBSCRIPTION_PLANS[subscription.plan as keyof typeof SUBSCRIPTION_PLANS]?.label ?? subscription.plan,
    priceCop: subscription.priceCop,
    startsAt: subscription.startsAt.toISOString(),
    expiresAt: subscription.expiresAt.toISOString(),
    isTrial: subscription.isTrial,
    isActive: true,
    daysRemaining: Math.max(0, Math.ceil((subscription.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))),
    paymentMethod: normalized.paymentMethod,
  });
});

// GET /api/drivers/me/subscription — current driver's active subscription
router.get("/me/subscription", authenticate, requireRole("driver"), async (req, res) => {
  const driverId = req.user!.userId;

  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.driverId, driverId))
    .orderBy(desc(subscriptionsTable.expiresAt))
    .limit(1);

  if (!sub) {
    const [createdSub] = await ensureDriverHasStarterSubscription(driverId);
    if (!createdSub) {
      res.status(404).json({ error: "No subscription found" });
      return;
    }
    res.json({
      id: createdSub.id,
      plan: createdSub.plan,
      planLabel: "Prueba gratuita",
      priceCop: createdSub.priceCop,
      startsAt: createdSub.startsAt.toISOString(),
      expiresAt: createdSub.expiresAt.toISOString(),
      isTrial: createdSub.isTrial,
      isActive: true,
      daysRemaining: Math.max(0, Math.ceil((createdSub.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
    });
    return;
  }

  const now = new Date();
  const isActive = sub.expiresAt > now;
  const daysRemaining = Math.max(0, Math.ceil((sub.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  const PLAN_LABELS: Record<string, string> = {
    trial: "Prueba gratuita",
    daily: "Diario",
    weekly: "Semanal",
    biweekly: "Quincenal",
    monthly: "Mensual",
  };

  res.json({
    id: sub.id,
    plan: sub.plan,
    planLabel: PLAN_LABELS[sub.plan] ?? sub.plan,
    priceCop: sub.priceCop,
    startsAt: sub.startsAt.toISOString(),
    expiresAt: sub.expiresAt.toISOString(),
    isTrial: sub.isTrial,
    isActive,
    daysRemaining,
  });
});

export default router;
