import { Router } from "express";
import { db } from "@workspace/db";
import { tripsTable, messagesTable, ratingsTable, usersTable, subscriptionsTable } from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { authenticate } from "../lib/auth.js";
import { formatUser } from "./auth.js";
import type { Server as IOServer } from "socket.io";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { uploadDir, saveAttachments, type IncomingAttachment } from "../lib/attachments.js";

const router = Router();
const ACTIVE_CHAT_STATUSES = ["accepted", "driver_arriving", "in_progress"] as const;
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  return db
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
}

let io: IOServer | null = null;
export function setIO(ioInstance: IOServer) {
  io = ioInstance;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Re-broadcast trip:new_request every 30s for up to 2 minutes to nearby eligible drivers.
 * If nobody accepts within 2 minutes, the trip auto-cancels and informs the passenger.
 */
async function scheduleRetries(
  tripId: number,
  passengerId: number,
  paymentMethod: string,
  originLat: number,
  originLng: number,
  enriched: any,
) {
  const retryDelaysMs = [30_000, 60_000, 90_000, 120_000];

  for (const delayMs of retryDelaysMs) {
    await sleep(delayMs);
    const [current] = await db
      .select({ id: tripsTable.id, status: tripsTable.status })
      .from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
    if (!current || current.status !== "pending") return;

    const eligibleIds = await getEligibleDriverIds(paymentMethod, originLat, originLng);
    for (const driverId of eligibleIds) {
      io?.to(`user:${driverId}`).emit("trip:new_request", enriched);
    }
  }

  await sleep(5_000);
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

export function resolveTripDestination(input: {
  originLat: number;
  originLng: number;
  destinationLat?: number | null;
  destinationLng?: number | null;
  destinationAddress?: string | null;
  originAddress?: string | null;
  destinationPending?: boolean;
}) {
  const normalizedOriginAddress = typeof input.originAddress === "string" ? input.originAddress.trim() : "";
  const normalizedDestinationAddress = typeof input.destinationAddress === "string" ? input.destinationAddress.trim() : "";

  const sameAsOrigin =
    typeof input.destinationLat === "number" &&
    typeof input.destinationLng === "number" &&
    Number.isFinite(input.destinationLat) &&
    Number.isFinite(input.destinationLng) &&
    Number(input.destinationLat) === Number(input.originLat) &&
    Number(input.destinationLng) === Number(input.originLng);

  const hasDestination =
    typeof input.destinationLat === "number" &&
    typeof input.destinationLng === "number" &&
    Number.isFinite(input.destinationLat) &&
    Number.isFinite(input.destinationLng) &&
    normalizedDestinationAddress.length > 0 &&
    !sameAsOrigin;

  const destinationPending = input.destinationPending === true || !hasDestination;
  const finalDestinationLat = hasDestination ? input.destinationLat : input.originLat;
  const finalDestinationLng = hasDestination ? input.destinationLng : input.originLng;
  const fallbackDestinationAddress = normalizedDestinationAddress || normalizedOriginAddress || "Ubicación de origen";
  const finalDestinationAddress = hasDestination ? normalizedDestinationAddress : fallbackDestinationAddress;

  return {
    sameAsOrigin,
    hasDestination,
    destinationPending,
    finalDestinationLat,
    finalDestinationLng,
    finalDestinationAddress,
  };
}

export const MIN_FARE_COP = 5500;
const FARE_INCREMENT_COP = 500;
const AUTOMATIC_FARE_INCREMENT_COP = 1000;

export function roundAutomaticFare(value: number): number {
  return Math.max(MIN_FARE_COP, Math.ceil(value / AUTOMATIC_FARE_INCREMENT_COP) * AUTOMATIC_FARE_INCREMENT_COP);
}

/** Taxi reference used for the economical fare (80%, within the approved 75–85% range). */
export function calculateEconomicalFare(distanceKm: number): number {
  const taxiReference = 4500 + Math.max(0, distanceKm) * 1800;
  return roundAutomaticFare(taxiReference * 0.8);
}

export function validateFare(value: unknown, minimum: number): number {
  const fare = Number(value);
  if (!Number.isFinite(fare) || fare < minimum || !Number.isInteger(fare) || fare % FARE_INCREMENT_COP !== 0) {
    throw new Error(`La tarifa debe ser un múltiplo de ${FARE_INCREMENT_COP} COP y no menor a ${minimum} COP`);
  }
  return fare;
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
    destinationLat: trip.destinationLat != null ? Number(trip.destinationLat) : null,
    destinationLng: trip.destinationLng != null ? Number(trip.destinationLng) : null,
    destinationAddress: trip.destinationAddress ?? null,
    destinationPending: (trip as any).destinationPending === true,
    vehicleType: trip.vehicleType,
    estimatedPrice: trip.estimatedPrice != null ? Number(trip.estimatedPrice) : null,
    minimumFare: (trip as any).minimumFare != null ? Number((trip as any).minimumFare) : null,
    passengerOffer: (trip as any).passengerOffer != null ? Number((trip as any).passengerOffer) : null,
    driverCounteroffer: (trip as any).driverCounteroffer != null ? Number((trip as any).driverCounteroffer) : null,
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
async function getOnlineDriverIds(): Promise<number[]> {
 const rows = await db
   .select({ id: usersTable.id })
   .from(usersTable)
   .where(
     and(
       eq(usersTable.role, "driver"),
       eq(usersTable.isOnline, true),
       eq(usersTable.isActive, true),
     )
   );
 return rows.map(r => r.id);
}

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
    .where(and(...conditions))
    .orderBy(desc(tripsTable.createdAt))
    .limit(parseInt(limit))
    .offset(parseInt(offset));

  res.json(trips.map(t => formatTrip(t)));
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
    vehicleType, paymentMethod,     estimatedPrice, passengerOffer,
    destinationPending,
  } = req.body as {
    originLat: number; originLng: number; originAddress: string;
    destinationLat?: number; destinationLng?: number; destinationAddress?: string;
    vehicleType: string; paymentMethod: string; estimatedPrice?: number; passengerOffer?: number;
    destinationPending?: boolean;
  };

  const destinationResolution = resolveTripDestination({
    originLat,
    originLng,
    destinationLat,
    destinationLng,
    destinationAddress,
    originAddress,
    destinationPending,
  });

  const {
    destinationPending: tripDestinationPending,
    finalDestinationLat,
    finalDestinationLng,
    finalDestinationAddress,
  } = destinationResolution;
  const normalizedOriginAddress =
    typeof originAddress === "string" && originAddress.trim()
      ? originAddress.trim()
      : "Ubicación de origen";

  const distanceKm = destinationResolution.hasDestination
    ? haversine(Number(originLat), Number(originLng), Number(finalDestinationLat), Number(finalDestinationLng))
    : null;
  const minimumFare = distanceKm == null ? null : calculateEconomicalFare(distanceKm);
  let validatedOffer: number | null = null;
  if (passengerOffer != null) {
    if (minimumFare == null) {
      res.status(400).json({ error: "No se puede proponer una tarifa sin destino" });
      return;
    }
    try { validatedOffer = validateFare(passengerOffer, minimumFare); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Oferta inválida" }); return; }
  }

  const [trip] = await db.insert(tripsTable).values({
    passengerId: user.userId,
    driverId: null,
    status: "pending",
    originLat: String(originLat),
    originLng: String(originLng),
    originAddress: normalizedOriginAddress || "Ubicación de origen",
    destinationLat: destinationResolution.hasDestination ? String(finalDestinationLat) : null,
    destinationLng: destinationResolution.hasDestination ? String(finalDestinationLng) : null,
    destinationAddress: destinationResolution.hasDestination ? finalDestinationAddress : null,
    destinationPending: tripDestinationPending,
    vehicleType,
    paymentMethod,
    estimatedPrice: minimumFare == null ? null : String(minimumFare),
    minimumFare: minimumFare == null ? null : String(minimumFare),
    passengerOffer: validatedOffer == null ? null : String(validatedOffer),
    distanceKm: distanceKm == null ? null : String(distanceKm),
  } as any).returning();

  const enriched = await enrichTrip(trip);

  // Notify immediately to nearby eligible drivers and, as a fallback, to all online drivers
  // so the trip appears without waiting for slow reconnections or stale location data.
  const eligibleIds = await getEligibleDriverIds(paymentMethod ?? "cash", originLat, originLng);
  const fallbackIds = eligibleIds.length > 0 ? eligibleIds : await getOnlineDriverIds();
  const broadcastIds = [...new Set(fallbackIds)];
  for (const driverId of broadcastIds) {
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

  const enriched = await Promise.all(trips.map(t => enrichTrip(t)));
  res.json(enriched);
});

// GET /api/trips/:id
router.get("/:id", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  res.json(await enrichTrip(trip));
});

// PATCH /api/trips/:id/status
router.patch("/:id/status", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const user = req.user!;
  const { status, cancelReason, finalPrice, fare } = req.body as {
    status: string;
    cancelReason?: string | null;
    finalPrice?: number | null;
    fare?: number | null;
  };

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  // Authorization: only the trip's passenger, the assigned driver,
  // or (for acceptance) an online driver may change the trip status
  const isParticipant = trip.passengerId === user.userId || trip.driverId === user.userId;
  if (status === "accepted") {
    if (user.role !== "driver") {
      res.status(403).json({ error: "Solo un conductor puede aceptar carreras" });
      return;
    }
    if (trip.status !== "pending") {
      res.status(409).json({ error: "Esta carrera ya fue tomada o cancelada" });
      return;
    }
  } else if (!isParticipant) {
    res.status(403).json({ error: "No tienes permiso para modificar esta carrera" });
    return;
  }

  const updates: Partial<typeof tripsTable.$inferInsert> = { status };

  if (status === "accepted") {
    // Allow a driver without a subscription record to receive a starter trial automatically.
    const [existingSub] = await db
      .select({ id: subscriptionsTable.id, expiresAt: subscriptionsTable.expiresAt })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.driverId, user.userId))
      .orderBy(subscriptionsTable.expiresAt)
      .limit(1);

    if (!existingSub) {
      await ensureDriverHasStarterSubscription(user.userId);
    }

    const [activeSub] = await db
      .select({ id: subscriptionsTable.id, expiresAt: subscriptionsTable.expiresAt })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.driverId, user.userId))
      .orderBy(subscriptionsTable.expiresAt)
      .limit(1);

    if (!activeSub || new Date(activeSub.expiresAt).getTime() <= Date.now()) {
      res.status(403).json({
        error: "Tu suscripción ha vencido. No puedes aceptar carreras.",
        code: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }

    const minimum = (trip as any).minimumFare == null ? null : Number((trip as any).minimumFare);
    if (minimum == null) {
      res.status(400).json({ error: "No se puede aceptar una carrera sin destino y tarifa" });
      return;
    }
    const passengerFare = (trip as any).passengerOffer != null
      ? Number((trip as any).passengerOffer)
      : minimum;
    const requestedFare = fare ?? ((trip as any).driverCounteroffer != null
      ? Number((trip as any).driverCounteroffer)
      : passengerFare);
    try {
      updates.finalPrice = String(validateFare(requestedFare, passengerFare));
    }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Tarifa inválida" }); return; }
    updates.driverId = user.userId;
    updates.driverAcceptedAt = new Date();
  } else if (status === "in_progress") {
    updates.startedAt = new Date();
  } else if (status === "completed") {
    updates.completedAt = new Date();
    if (finalPrice != null) {
      if ((trip as any).minimumFare == null) {
        res.status(400).json({ error: "No se puede registrar una tarifa sin destino" });
        return;
      }
      try { updates.finalPrice = String(validateFare(finalPrice, Number((trip as any).minimumFare))); }
      catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Tarifa inválida" }); return; }
    }
  } else if (status === "cancelled") {
    updates.cancelledAt = new Date();
    if (cancelReason) updates.cancelReason = cancelReason;
  }

  // For acceptance, claim atomically: only succeeds if the trip is still pending
  const whereClause = status === "accepted"
    ? and(eq(tripsTable.id, tripId), eq(tripsTable.status, "pending"))
    : eq(tripsTable.id, tripId);

  const [updated] = await db
    .update(tripsTable)
    .set(updates)
    .where(whereClause)
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Esta carrera ya fue tomada o cancelada" });
    return;
  }

  const enriched = await enrichTrip(updated);

  // Notify passenger and driver about status change
  // Emit both the generic event (for home screen) and the status-specific event (for trip detail screen)
  io?.to(`trip:${tripId}`).emit("trip_status_updated", enriched);
  io?.to(`trip:${tripId}`).emit(`trip:${status}`, enriched);
  io?.to(`user:${trip.passengerId}`).emit("trip_status_updated", enriched);
  if (trip.driverId) io?.to(`user:${trip.driverId}`).emit("trip_status_updated", enriched);

  res.json(enriched);
});

// Passenger offer and driver counteroffer are deliberately separate endpoints so
// every fare mutation is validated on the server.
router.post("/:id/offer", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) { res.status(404).json({ error: "Trip not found" }); return; }
  if (trip.passengerId !== req.user!.userId || (trip as any).minimumFare == null) {
    res.status(403).json({ error: "Solo el pasajero puede ofertar en una carrera con destino" }); return;
  }
  try {
    const offer = validateFare(req.body?.amount, Number((trip as any).minimumFare));
    const [updated] = await db.update(tripsTable).set({ passengerOffer: String(offer), driverCounteroffer: null } as any)
      .where(and(eq(tripsTable.id, tripId), eq(tripsTable.status, "pending"))).returning();
    if (!updated) { res.status(409).json({ error: "La carrera ya no está disponible" }); return; }
    const result = await enrichTrip(updated);
    io?.to(`trip:${tripId}`).emit("trip_fare_updated", result);
    res.json(result);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Oferta inválida" }); }
});

router.post("/:id/counteroffer", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) { res.status(404).json({ error: "Trip not found" }); return; }
  if (req.user!.role !== "driver" || trip.status !== "pending" || (trip as any).minimumFare == null) {
    res.status(403).json({ error: "Solo un conductor puede contraofertar una carrera pendiente" }); return;
  }
  const base = (trip as any).passengerOffer == null ? Number((trip as any).minimumFare) : Number((trip as any).passengerOffer);
  try {
    const counter = validateFare(req.body?.amount, base + FARE_INCREMENT_COP);
    const [updated] = await db.update(tripsTable).set({ driverCounteroffer: String(counter) } as any)
      .where(and(eq(tripsTable.id, tripId), eq(tripsTable.status, "pending"))).returning();
    if (!updated) { res.status(409).json({ error: "La carrera ya no está disponible" }); return; }
    const result = await enrichTrip(updated);
    io?.to(`trip:${tripId}`).emit("trip_fare_updated", result);
    io?.to(`user:${trip.passengerId}`).emit("trip_fare_updated", result);
    res.json(result);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Contraoferta inválida" }); }
});

// GET /api/trips/:id/messages
router.get("/:id/messages", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const user = req.user!;
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);

  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const isParticipant = trip.passengerId === user.userId || trip.driverId === user.userId;
  if (!isParticipant) {
    res.status(403).json({ error: "Only trip participants can access this chat" });
    return;
  }

  if (!ACTIVE_CHAT_STATUSES.includes(trip.status as typeof ACTIVE_CHAT_STATUSES[number])) {
    res.json([]);
    return;
  }

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
    attachments: m.attachments ?? [],
    senderName: senderMap.get(m.senderId) ?? "Unknown",
    createdAt: m.createdAt.toISOString(),
  })));
});

// POST /api/trips/:id/messages
router.post("/:id/messages", authenticate, async (req, res) => {
  const tripId = Number(req.params["id"]);
  const { content, attachments } = req.body as { content: string; attachments?: IncomingAttachment[] };
  const user = req.user!;

  if (!content?.trim() && !attachments?.length) {
    res.status(400).json({ error: "content or attachments are required" });
    return;
  }

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const isParticipant = trip.passengerId === user.userId || trip.driverId === user.userId;
  if (!isParticipant) {
    res.status(403).json({ error: "Only trip participants can use this chat" });
    return;
  }

  if (!ACTIVE_CHAT_STATUSES.includes(trip.status as typeof ACTIVE_CHAT_STATUSES[number])) {
    res.status(409).json({ error: "Trip chat is available after a driver accepts the trip" });
    return;
  }

  let savedAttachments;
  try {
    savedAttachments = await saveAttachments(attachments, "trips");
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid attachments" });
    return;
  }
  const [message] = await db
    .insert(messagesTable)
    .values({ tripId, senderId: user.userId, content: content?.trim() ?? "", attachments: savedAttachments })
    .returning();

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId)).limit(1);

  const formatted = {
    id: message.id,
    tripId: message.tripId,
    senderId: message.senderId,
    content: message.content,
    attachments: message.attachments ?? [],
    senderName: sender?.name ?? "Unknown",
    createdAt: message.createdAt.toISOString(),
  };

  // Emit under both names so the trip detail screen listener matches
  io?.to(`trip:${tripId}`).emit("message:new", formatted);

  res.status(201).json(formatted);
});

router.get("/attachments/:filename", authenticate, async (req, res) => {
  const filename = path.basename(String(req.params["filename"]));
  const [message] = await db.select({ tripId: messagesTable.tripId, attachments: messagesTable.attachments })
    .from(messagesTable).where(sql`${messagesTable.attachments}::text LIKE ${`%${filename}%`}`).limit(1);
  const metadata = message?.attachments?.find(file => file.url.endsWith(`/${filename}`));
  if (!message || !metadata) { res.status(404).json({ error: "Attachment not found" }); return; }
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, message.tripId)).limit(1);
  const user = req.user!;
  if (!trip || (trip.passengerId !== user.userId && trip.driverId !== user.userId && user.role !== "admin")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  try { res.type(metadata.mimeType); res.send(await readFile(path.join(uploadDir, filename))); }
  catch { res.status(404).json({ error: "Attachment not found" }); }
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
