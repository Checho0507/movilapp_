import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, tripsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
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

  const conditions = [];
  if (role) conditions.push(eq(usersTable.role, role));
  if (isActive !== undefined) conditions.push(eq(usersTable.isActive, isActive === "true"));

  const users = await db
    .select()
    .from(usersTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(usersTable.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));

  res.json(users.map(formatUser));
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

  res.json(
    trips.map(t => ({
      id: t.id,
      passengerId: t.passengerId,
      driverId: t.driverId,
      status: t.status,
      originLat: Number(t.originLat),
      originLng: Number(t.originLng),
      originAddress: t.originAddress,
      destinationLat: Number(t.destinationLat),
      destinationLng: Number(t.destinationLng),
      destinationAddress: t.destinationAddress,
      vehicleType: t.vehicleType,
      estimatedPrice: Number(t.estimatedPrice),
      finalPrice: t.finalPrice != null ? Number(t.finalPrice) : null,
      paymentMethod: t.paymentMethod,
      cancelReason: t.cancelReason,
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      cancelledAt: t.cancelledAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }))
  );
});

export default router;
