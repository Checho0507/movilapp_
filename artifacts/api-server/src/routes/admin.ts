import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, tripsTable, subscriptionsTable, subscriptionPlansTable, SUBSCRIPTION_PLANS } from "@workspace/db";
import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import { authenticate, requireRole } from "../lib/auth.js";
import { formatUser } from "./auth.js";

const router = Router();

// GET /api/admin/stats
router.get("/stats", authenticate, requireRole("admin"), async (_req, res) => {
  const [stats] = await db.select({
    totalUsers: sql<number>`COUNT(*)::int`,
    totalDrivers: sql<number>`COUNT(*) FILTER (WHERE role = 'driver')::int`,
    totalPassengers: sql<number>`COUNT(*) FILTER (WHERE role = 'passenger')::int`,
    onlineDrivers: sql<number>`COUNT(*) FILTER (WHERE role = 'driver' AND is_online = true)::int`,
  }).from(usersTable);

  const [tripStats] = await db.select({
    activeTrips: sql<number>`COUNT(*) FILTER (WHERE status IN ('pending', 'accepted', 'driver_arriving', 'in_progress'))::int`,
    completedTrips: sql<number>`COUNT(*) FILTER (WHERE status = 'completed')::int`,
    pendingTrips: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')::int`,
    totalRevenue: sql<number>`COALESCE(SUM(final_price::numeric) FILTER (WHERE status = 'completed'), 0)::float`,
  }).from(tripsTable);

  res.json({
    totalUsers: stats?.totalUsers ?? 0,
    totalDrivers: stats?.totalDrivers ?? 0,
    totalPassengers: stats?.totalPassengers ?? 0,
    onlineDrivers: stats?.onlineDrivers ?? 0,
    activeTrips: tripStats?.activeTrips ?? 0,
    completedTrips: tripStats?.completedTrips ?? 0,
    pendingTrips: tripStats?.pendingTrips ?? 0,
    totalRevenue: tripStats?.totalRevenue ?? 0,
  });
});

// GET /api/admin/users
router.get("/users", authenticate, requireRole("admin"), async (req, res) => {
  const { role, isActive, limit = "50", offset = "0" } = req.query as Record<string, string>;
  const pageLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const pageOffset = Math.max(Number(offset) || 0, 0);

  const conditions = [];
  if (role) conditions.push(eq(usersTable.role, role));
  if (isActive !== undefined) conditions.push(eq(usersTable.isActive, isActive === "true"));

  const users = await db
    .select()
    .from(usersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(usersTable.createdAt))
    .limit(pageLimit)
    .offset(pageOffset);

  const driverIds = users.filter(user => user.role === "driver").map(user => user.id);
  const completedCounts = driverIds.length
    ? await db.select({
        driverId: tripsTable.driverId,
        count: sql<number>`COUNT(*)::int`,
      }).from(tripsTable)
        .where(and(inArray(tripsTable.driverId, driverIds), eq(tripsTable.status, "completed")))
        .groupBy(tripsTable.driverId)
    : [];
  const completedByDriver = new Map(completedCounts.map(row => [row.driverId, row.count]));
  res.json(users.map(user => ({
    ...formatUser(user),
    completedTrips: completedByDriver.get(user.id) ?? 0,
  })));
});

// PATCH /api/admin/users/:id/status
router.patch("/users/:id/status", authenticate, requireRole("admin"), async (req, res) => {
  const userId = Number(req.params["id"]);
  const { isActive } = req.body as { isActive: boolean };

  const [user] = await db
    .update(usersTable)
    .set({ isActive })
    .where(eq(usersTable.id, userId))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

// GET /api/admin/trips
router.get("/trips", authenticate, requireRole("admin"), async (req, res) => {
  const { status, limit = "50", offset = "0" } = req.query as Record<string, string>;

  const conditions = [];
  if (status) conditions.push(eq(tripsTable.status, status));

  const trips = await db
    .select()
    .from(tripsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(tripsTable.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));

  const userIds = [...new Set(trips.flatMap(t => [t.passengerId, t.driverId].filter((id): id is number => id != null)))];
  const users = userIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const usersById = new Map(users.map(user => [user.id, user]));

  res.json(
    trips.map(t => ({
      id: t.id,
      passengerId: t.passengerId,
      driverId: t.driverId,
      status: t.status,
      originLat: Number(t.originLat),
      originLng: Number(t.originLng),
      originAddress: t.originAddress,
      destinationLat: t.destinationLat != null ? Number(t.destinationLat) : null,
      destinationLng: t.destinationLng != null ? Number(t.destinationLng) : null,
      destinationAddress: t.destinationAddress ?? null,
      destinationPending: t.destinationPending,
      vehicleType: t.vehicleType,
      estimatedPrice: Number(t.estimatedPrice),
      finalPrice: t.finalPrice != null ? Number(t.finalPrice) : null,
      distanceKm: t.distanceKm != null ? Number(t.distanceKm) : null,
      paymentMethod: t.paymentMethod,
      cancelReason: t.cancelReason,
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      cancelledAt: t.cancelledAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      passenger: usersById.get(t.passengerId) ?? undefined,
      driver: t.driverId ? usersById.get(t.driverId) ?? undefined : undefined,
    }))
  );
});

router.get("/subscriptions/stats", authenticate, requireRole("admin"), async (_req, res) => {
  const now = new Date();
  const rows = await db.select().from(subscriptionsTable);
  const active = rows.filter(s => s.expiresAt > now);
  res.json({
    active: active.filter(s => !s.isTrial).length,
    trial: active.filter(s => s.isTrial).length,
    expired: rows.filter(s => s.expiresAt <= now).length,
    monthlyRevenueCop: active.filter(s => !s.isTrial && s.plan === "monthly").reduce((sum, s) => sum + s.priceCop, 0),
    totalRevenueCop: rows.filter(s => !s.isTrial).reduce((sum, s) => sum + s.priceCop, 0),
  });
});

router.get("/subscriptions/plans", authenticate, requireRole("admin"), async (_req, res) => {
  const plans = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.isActive, true));
  res.json(plans);
});

router.get("/subscriptions", authenticate, requireRole("admin"), async (req, res) => {
  const { plan, status, limit = "500", offset = "0" } = req.query as Record<string, string>;
  const rows = await db.select({
    id: subscriptionsTable.id,
    driverId: subscriptionsTable.driverId,
    plan: subscriptionsTable.plan,
    priceCop: subscriptionsTable.priceCop,
    startsAt: subscriptionsTable.startsAt,
    expiresAt: subscriptionsTable.expiresAt,
    isTrial: subscriptionsTable.isTrial,
    notes: subscriptionsTable.notes,
    createdAt: subscriptionsTable.createdAt,
    driverName: usersTable.name,
    driverPhone: usersTable.phone,
    planLabel: subscriptionPlansTable.label,
  }).from(subscriptionsTable)
    .leftJoin(usersTable, eq(subscriptionsTable.driverId, usersTable.id))
    .leftJoin(subscriptionPlansTable, eq(subscriptionsTable.plan, subscriptionPlansTable.key))
    .where(and(
      plan ? eq(subscriptionsTable.plan, plan) : undefined,
      status === "active" ? gte(subscriptionsTable.expiresAt, new Date())
        : status === "expired" ? lte(subscriptionsTable.expiresAt, new Date())
        : status === "trial" ? eq(subscriptionsTable.isTrial, true)
        : undefined,
    ))
    .orderBy(desc(subscriptionsTable.createdAt))
    .limit(Math.min(Math.max(Number(limit) || 500, 1), 500))
    .offset(Math.max(Number(offset) || 0, 0));
  res.json(rows.map(s => ({
    ...s,
    planLabel: s.planLabel ?? s.plan,
    isActive: s.expiresAt > new Date(),
    daysRemaining: Math.max(0, Math.ceil((s.expiresAt.getTime() - Date.now()) / 86_400_000)),
    driver: s.driverName ? { id: s.driverId, name: s.driverName, phone: s.driverPhone } : null,
    startsAt: s.startsAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
  })));
});

router.post("/subscriptions", authenticate, requireRole("admin"), async (req, res) => {
  const { driverId, plan, notes } = req.body as { driverId?: number; plan?: string; notes?: string };
  const [planInfo] = plan
    ? await db.select().from(subscriptionPlansTable).where(and(eq(subscriptionPlansTable.key, plan), eq(subscriptionPlansTable.isActive, true))).limit(1)
    : [];
  if (!driverId || !planInfo || plan === "trial") {
    res.status(400).json({ error: "Conductor y plan válido son requeridos." });
    return;
  }
  const [driver] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(eq(usersTable.id, driverId), eq(usersTable.role, "driver"))).limit(1);
  if (!driver) {
    res.status(404).json({ error: "Conductor no encontrado." });
    return;
  }
  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + planInfo.days * 86_400_000);
  const [subscription] = await db.insert(subscriptionsTable).values({
    driverId, plan: planInfo.key, priceCop: planInfo.priceCop, startsAt, expiresAt, isTrial: false,
    createdById: req.user!.userId, notes: notes?.trim() || null,
  }).returning();
  res.status(201).json(subscription);
});

export default router;
