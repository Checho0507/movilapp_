import { Router } from "express";
import { db } from "@workspace/db";
import { vehiclesTable, subscriptionsTable, SUBSCRIPTION_PLANS } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { authenticate, requireRole } from "../lib/auth.js";

const router = Router();

// GET /api/vehicles — list this driver's registered vehicles
router.get("/", authenticate, requireRole("driver"), async (req, res) => {
  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.driverId, req.user!.userId));

  res.json(
    vehicles.map(v => ({
      id: v.id,
      driverId: v.driverId,
      plate: v.plate,
      model: v.model,
      brand: v.brand,
      color: v.color,
      lateral: v.lateral,
      vehicleType: v.vehicleType,
      createdAt: v.createdAt.toISOString(),
    }))
  );
});

// POST /api/vehicles — register a new vehicle and (conditionally) start trial
router.post("/", authenticate, requireRole("driver"), async (req, res) => {
  const driverId = req.user!.userId;
  const { plate, model, brand, color, vehicleType, lateral } = req.body as {
    plate: string; model: string; brand: string; color: string;
    vehicleType: string; lateral?: string;
  };

  if (!plate || !model || !brand || !color || !vehicleType) {
    res.status(400).json({ error: "plate, model, brand, color and vehicleType are required" });
    return;
  }

  const normalizedPlate = plate.trim().toUpperCase();

  // Prevent the same driver from registering the same plate twice
  const [alreadyOwned] = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.driverId, driverId), eq(vehiclesTable.plate, normalizedPlate)))
    .limit(1);

  if (alreadyOwned) {
    res.status(409).json({ error: "You already have this vehicle registered" });
    return;
  }

  // Insert the vehicle
  const [vehicle] = await db
    .insert(vehiclesTable)
    .values({
      driverId,
      plate: normalizedPlate,
      model,
      brand,
      color,
      vehicleType,
      lateral: lateral?.trim() ?? null,
    })
    .returning();

  // ── Trial eligibility check ──────────────────────────────────────────────
  // The trial is tied to the PLATE, not the account. A plate that has already
  // been used to claim a trial on ANY previous account is not eligible again.
  // This prevents drivers from creating new accounts to bypass the subscription.

  // 1. Does this driver already have ANY subscription? (re-registration guard)
  const [existingSub] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.driverId, driverId))
    .limit(1);

  let trialGranted = false;
  let trialDeniedReason: string | null = null;

  if (existingSub) {
    // Driver already has a subscription — this is an additional vehicle registration, no new trial
    trialDeniedReason = "already_subscribed";
  } else {
    // 2. Has this plate been registered to a DIFFERENT account that used a trial?
    const [previousOwner] = await db
      .select({ driverId: vehiclesTable.driverId })
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.plate, normalizedPlate),
          ne(vehiclesTable.driverId, driverId),
        )
      )
      .limit(1);

    if (previousOwner) {
      // Check if that previous owner actually used a trial
      const [previousTrial] = await db
        .select({ id: subscriptionsTable.id })
        .from(subscriptionsTable)
        .where(
          and(
            eq(subscriptionsTable.driverId, previousOwner.driverId),
            eq(subscriptionsTable.isTrial, true),
          )
        )
        .limit(1);

      if (previousTrial) {
        // Trial was already used for this plate — not eligible
        trialDeniedReason = "plate_trial_used";
      }
    }

    if (!trialDeniedReason) {
      // ✅ Eligible — grant the 60-day trial
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SUBSCRIPTION_PLANS.trial.days * 24 * 60 * 60 * 1000);
      await db.insert(subscriptionsTable).values({
        driverId,
        plan: "trial",
        priceCop: 0,
        startsAt: now,
        expiresAt,
        isTrial: true,
      });
      trialGranted = true;
    }
  }

  res.status(201).json({
    id: vehicle.id,
    driverId: vehicle.driverId,
    plate: vehicle.plate,
    model: vehicle.model,
    brand: vehicle.brand,
    color: vehicle.color,
    lateral: vehicle.lateral,
    vehicleType: vehicle.vehicleType,
    createdAt: vehicle.createdAt.toISOString(),
    // Let the client know what happened with the trial
    trial: trialGranted
      ? { granted: true, daysRemaining: SUBSCRIPTION_PLANS.trial.days }
      : { granted: false, reason: trialDeniedReason },
  });
});

export default router;
