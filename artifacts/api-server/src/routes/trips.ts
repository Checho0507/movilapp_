import { Router } from "express";
import { db } from "@workspace/db";
import { tripsTable, messagesTable, ratingsTable, usersTable, subscriptionsTable } from "@workspace/db";
import { eq, and, desc, sql, inArray, gt } from "drizzle-orm";
import { authenticate } from "../lib/auth.js";
import { formatUser } from "./auth.js";
import type { Server as IOServer } from "socket.io";

const router = Router();

let io: IOServer | null = null;
export function setIO(ioInstance: IOServer) {
  io = ioInstance;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Retry trip:new_request up to 3 rounds (0s, 10s, 20s).
 * After 30s with no acceptance, auto-cancels the trip and notifies the passenger.
 */
async function scheduleRetries(
  tripId: number,
  passengerId: number,
  paymentMethod: string,
  originLat: number,
  originLng: number,
  enriched: any,
) {
  for (let round = 2; round <= 3; round++) {
    await sleep(10_000);
    const [current] = await db
      .select({ id: tripsTable.id, status: tripsTable.status })
      .from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
    if (!current || current.status !== "pending") return; // accepted / cancelled already

    const eligibleIds = await getEligibleDriverIds(paymentMethod, originLat, originLng);
    for (const driverId of eligibleIds) {
      io?.to(`user:${driverId}`).emit("trip:new_request", enriched);
    }
  }

  // 10 s after the 3rd emit — if still pending, auto-cancel
  await sleep(10_000);
  const [current] = await db
    .select({ id: tripsTable.id, status: tripsTable.status })
    .from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!current || current.status !== "pending") return;

  const [cancelled] = await db
    .update(tripsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: "No se encontraron conductores disponibles" })
    .where(and(eq(tripsTable.id, tripId), eq(tripsTable.status, "pending")))
    .returning();

  if (cancelled) {
    const enrichedCancelled = await enrichTrip(cancelled);
    io?.to(`user:${passengerId}`).emit("trip_status_updated", enrichedCancelled);
    io?.to(`trip:${tripId}`).emit("trip:cancelled", enrichedCancelled);
  }
}

function formatTrip(
  trip: typeof tripsTable.$inferSelect,
  passenger?: typeof usersTable.$inferSelect | null,
  driver?: typeof usersTable.$inferSelect | null
) {
  return {
    id: trip.id,
    passengerId: trip.passengerId,
    driverId: trip.driverId,
    status: trip.status,
    originLat: Number(trip.originLat),
    originLng: Number(trip.originLng),
    originAddress: trip.originAddress,
    destinationLat: Number(trip.destinationLat),
    destinationLng: Number(trip.destinationLng),
    destinationAddress: trip.destinationAddress,
    vehicleType: trip.vehicleType,
    estimatedPrice: Number(trip.estimatedPrice),
    finalPrice: trip.finalPrice != null ? Number(trip.finalPrice) : null,
    actualPrice: trip.actualPrice != null ? Number(trip.actualPrice) : null,
    distanceKm: trip.distanceKm != null ? Number(trip.distanceKm) : null,
    paymentMethod: trip.paymentMethod,
    cancelReason: trip.cancelReason,
    // Last 2 digits of passenger phone — used by driver to verify passenger identity
    passengerCode: passenger?.phone?.slice(-2) ?? null,
    driverAcceptedAt: trip.driverAcceptedAt?.toISOString() ?? null,
    startedAt: trip.startedAt?.toISOString() ?? null,
    completedAt: trip.completedAt?.toISOString() ?? null,
    cancelledAt: trip.cancelledAt?.toISOString() ?? null,
    createdAt: trip.createdAt.toISOString(),
    passenger: passenger ? formatUser(passenger) : undefined,
    driver: driver
      ? {
          id: driver.id,
          name: driver.name,
          phone: driver.phone,
          rating: Number(driver.rating),
          currentLat: driver.currentLat != null ? Number(driver.currentLat) : null,
          currentLng: driver.currentLng != null ? Number(driver.currentLng) : null,
        }
      : null,
  };
}

async function enrichTrip(trip: typeof tripsTable.$inferSelect) {
  const [passenger] = await db.select().from(usersTable).where(eq(usersTable.id, trip.passengerId)).limit(1);
  let driver = null;
  if (trip.driverId) {
    const [d] = await db.select().from(usersTable).where(eq(usersTable.id, trip.driverId)).limit(1);
    driver = d ?? null;
  }
  return formatTrip(trip, passenger, driver);
}

/**
 * Haversine distance filter: returns true when the driver is within `radiusKm` of the origin.
 * Requires currentLat/currentLng to be non-null.
 */
function withinRadius(lat: number, lng: number, radiusKm = 1) {
  return sql`
    ${usersTable.currentLat} IS NOT NULL
    AND ${usersTable.currentLng} IS NOT NULL
    AND (
      2 * 6371 * asin(sqrt(
        pow(sin(radians((${usersTable.currentLat}::numeric - ${lat}) / 2)), 2)
        + cos(radians(${lat}))
        * cos(radians(${usersTable.currentLat}::numeric))
        * pow(sin(radians((${usersTable.currentLng}::numeric - ${lng}) / 2)), 2)
      ))
    ) <= ${radiusKm}
  `;
}

/**
 * Find eligible online driver IDs within 1 km of the trip origin,
 * filtered by payment method.
 * - cash: all nearby online drivers
 * - nequi/daviplata/breve: only nearby drivers who have that method in acceptedPayments
 */
async function getEligibleDriverIds(
  paymentMethod: string,
  originLat: number,
  originLng: number,
): Promise<number[]> {
  const baseConditions = and(
    eq(usersTable.role, "driver"),
    eq(usersTable.isOnline, true),
    eq(usersTable.isActive, true),
    withinRadius(originLat, originLng, 1),
  );

  if (paymentMethod === "cash") {
    const rows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(baseConditions);
    return rows.map(r => r.id);
  }

  // Digital method: driver must also have opted in
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        baseConditions,
        sql`${usersTable.acceptedPayments} @> ARRAY[${paymentMethod}]::text[]`,
      )
    );
  return rows.map(r => r.id);
}

// GET /api/trips
router.get("/", authenticate, async (req, res) => {
  const { status, limit = "20", offset = "0" } = req.query as Record<string, string>;
  const user = req.user!;

  let conditions = user.role === "driver"
    ? [eq(tripsTable.driverId, user.userId)]
    : [eq(tripsTable.passengerId, user.userId)];

  if (status) conditions.push(eq(tripsTable.status, status));

  const trips = await db
    .select()
    .from(tripsTable)
    .where(
      and(
        eq(tripsTable.status, "pending"),
        sql`${tripsTable.originLat}::numeric BETWEEN ${latN - deltaLat} AND ${latN + deltaLat}`,
        sql`${tripsTable.originLng}::numeric BETWEEN ${lngN - deltaLng} AND ${lngN + deltaLng}`
      )
    )
    .orderBy(desc(tripsTable.createdAt))
    .limit(20);

  const enriched = await enrichTrip(updated);
  res.json(enriched);
});

// POST /api/trips
router.post("/", authenticate, async (req, res) => {
  const user = req.user!;
  if (user.role !== "passenger") {
    res.status(403).json({ error: "Only passengers can request trips" });
    return;
  }

  const {
    originLat, originLng, originAddress,
    destinationLat, destinationLng, destinationAddress,
    vehicleType, paymentMethod, estimatedPrice,
  } = req.body as {
    originLat: number; originLng: number; originAddress: string;
    destinationLat: number; destinationLng: number; destinationAddress: string;
    vehicleType: string; paymentMethod: string; estimatedPrice?: number;
  };

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);

  const enriched = await enrichTrip(updated);

  // Notify only eligible online drivers within 1 km, filtered by payment method
  const eligibleIds = await getEligibleDriverIds(paymentMethod ?? "cash", originLat, originLng);
  for (const driverId of eligibleIds) {
    io?.to(`user:${driverId}`).emit("trip:new_request", enriched);
  }

  res.status(201).json(enriched);

  // Fire-and-forget: retry notifications and auto-cancel if no driver accepts
  scheduleRetries(trip.id, user.userId, paymentMethod ?? "cash", originLat, originLng, enriched).catch(() => {});
});

// GET /api/trips/nearby (must be before /api/trips/:id)
router.get("/nearby", authenticate, async (req, res) => {
  const { lat, lng, radius = "5" } = req.query as Record<string, string>;
  if (!lat || !lng) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }

  const latN = Number(lat);
  const lngN = Number(lng);
  const radiusKm = Number(radius);

  // ~1 degree lat = 111km
  const deltaLat = radiusKm / 111;
  const deltaLng = radiusKm / (111 * Math.cos((latN * Math.PI) / 180));

  const trips = await db
    .select()
    .from(tripsTable)
    .where(
      and(
        eq(tripsTable.status, "pending"),
        sql`${tripsTable.originLat}::numeric BETWEEN ${latN - deltaLat} AND ${latN + deltaLat}`,
        sql`${tripsTable.originLng}::numeric BETWEEN ${lngN - deltaLng} AND ${lngN + deltaLng}`
      )
    )
    .orderBy(desc(tripsTable.createdAt))
    .limit(20);

  const enriched = await enrichTrip(updated);

  // Notify passenger and driver about status change
  // Emit both the generic event (for home screen) and the status-specific event (for trip detail screen)
  io?.to(`trip:${tripId}`).emit("trip_status_updated", enriched);
  io?.to(`trip:${tripId}`).emit(`trip:${status}`, enriched);
  io?.to(`user:${trip.passengerId}`).emit("trip_status_updated", enriched);
  if (trip.driverId) io?.to(`user:${trip.driverId}`).emit("trip_status_updated", enriched);

  res.json(enriched);
});

// GET /api/trips/:id/messages
router.get("/:id/messages", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  await db
    .update(tripsTable)
    .set({ actualPrice: String(Number(price)) })
    .where(eq(tripsTable.id, tripId));

  res.json({ ok: true });
});

// POST /api/trips/:id/rating
router.post("/:id/rating", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const user = req.user!;
  const { status, cancelReason, finalPrice } = req.body as {
    status: string;
    cancelReason?: string | null;
    finalPrice?: number | null;
  };

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const updates: Partial<typeof tripsTable.$inferInsert> = { status };

    const now = new Date();

  if (status === "accepted") {
    // Verify the driver has an active subscription before allowing them to accept trips
    const [activeSub] = await db
      .select({ id: subscriptionsTable.id })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.driverId, user.userId),
          gt(subscriptionsTable.expiresAt, new Date()),
        )
      )
      .limit(1);

    if (!activeSub) {
      res.status(403).json({
        error: "Tu suscripción ha vencido. No puedes aceptar carreras.",
        code: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }

    updates.driverId = user.userId;
    updates.driverAcceptedAt = new Date();
  } else if (status === "in_progress") {
    updates.startedAt = new Date();
  } else if (status === "completed") {
    updates.completedAt = new Date();
    if (finalPrice != null) updates.finalPrice = String(finalPrice);
  } else if (status === "cancelled") {
    updates.cancelledAt = new Date();
    if (cancelReason) updates.cancelReason = cancelReason;
  }

  const [updated] = await db
    .update(tripsTable)
    .set(updates)
    .where(eq(tripsTable.id, tripId))
    .returning();

  const enriched = await enrichTrip(updated);

  // Notify passenger and driver about status change
  // Emit both the generic event (for home screen) and the status-specific event (for trip detail screen)
  io?.to(`trip:${tripId}`).emit("trip_status_updated", enriched);
  io?.to(`trip:${tripId}`).emit(`trip:${status}`, enriched);
  io?.to(`user:${trip.passengerId}`).emit("trip_status_updated", enriched);
  if (trip.driverId) io?.to(`user:${trip.driverId}`).emit("trip_status_updated", enriched);

  res.json(enriched);
});

// GET /api/trips/:id/messages
router.get("/:id/messages", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.tripId, tripId))
    .orderBy(messagesTable.createdAt);

  const senderIds = [...new Set(messages.map(m => m.senderId))];
  const senders = senderIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, senderIds))
    : [];
  const senderMap = new Map(senders.map(s => [s.id, s.name]));

  res.json(messages.map(m => ({
    id: m.id,
    tripId: m.tripId,
    senderId: m.senderId,
    content: m.content,
    senderName: senderMap.get(m.senderId) ?? "Unknown",
    createdAt: m.createdAt.toISOString(),
  })));
});

// POST /api/trips/:id/messages
router.post("/:id/messages", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const { content } = req.body as { content: string };
  const user = req.user!;

  if (!content?.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const [message] = await db
    .insert(messagesTable)
    .values({ tripId, senderId: user.userId, content: content.trim() })
    .returning();

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId)).limit(1);

  const formatted = {
    id: message.id,
    tripId: message.tripId,
    senderId: message.senderId,
    content: message.content,
    senderName: sender?.name ?? "Unknown",
    createdAt: message.createdAt.toISOString(),
  };

  // Emit under both names so the trip detail screen listener matches
  io?.to(`trip:${tripId}`).emit("message:new", formatted);

  res.status(201).json(formatted);
});

// POST /api/trips/:id/actual-price — passenger reports the real price paid
router.post("/:id/actual-price", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const { price } = req.body as { price: number };

  if (!price || isNaN(Number(price)) || Number(price) <= 0) {
    res.status(400).json({ error: "price must be a positive number" });
    return;
  }

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  await db
    .update(tripsTable)
    .set({ actualPrice: String(Number(price)) })
    .where(eq(tripsTable.id, tripId));

  res.json({ ok: true });
});

// POST /api/trips/:id/rating
router.post("/:id/rating", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const user = req.user!;
  const { score, comment } = req.body as { score: number; comment?: string | null };

  if (!score || score < 1 || score > 5) {
    res.status(400).json({ error: "score must be between 1 and 5" });
    return;
  }

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  // Ratings only make sense once a driver is assigned
  if (trip.status !== "completed" && trip.status !== "in_progress") {
    res.status(409).json({ error: "Trip must be in progress or completed before rating" });
    return;
  }

  // Determine who is being rated
  const rateeId = user.role === "passenger" ? trip.driverId : trip.passengerId;
  if (!rateeId) {
    res.status(409).json({ error: "No driver assigned to this trip yet" });
    return;
  }

  const [rating] = await db
    .insert(ratingsTable)
    .values({ tripId, raterId: user.userId, rateeId, score, comment: comment ?? null })
    .returning();

  // Recalculate ratee's average rating
  const [avgResult] = await db
    .select({ avg: sql<string>`AVG(score)`, cnt: sql<string>`COUNT(*)` })
    .from(ratingsTable)
    .where(eq(ratingsTable.rateeId, rateeId));

  if (avgResult) {
    await db.update(usersTable).set({
      rating: String(Number(avgResult.avg).toFixed(1)),
      ratingCount: Number(avgResult.cnt),
    }).where(eq(usersTable.id, rateeId));
  }

  res.status(201).json({
    id: rating.id,
    tripId: rating.tripId,
    raterId: rating.raterId,
    rateeId: rating.rateeId,
    score: rating.score,
    comment: rating.comment,
    createdAt: rating.createdAt.toISOString(),
  });
});

export default router;

    const [sub] = await db
      .select({ expiresAt: subscriptionsTable.expiresAt })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.driverId, user.userId))
      .orderBy(desc(subscriptionsTable.expiresAt))
      .limit(1);
