import { Router } from "express";
import { db } from "@workspace/db";
import { vehiclesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate, requireRole } from "../lib/auth.js";

const router = Router();

// GET /api/vehicles
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

// POST /api/vehicles
router.post("/", authenticate, requireRole("driver"), async (req, res) => {
  const { plate, model, brand, color, vehicleType, lateral } = req.body as {
    plate: string; model: string; brand: string; color: string;
    vehicleType: string; lateral?: string;
  };

  const [vehicle] = await db
    .insert(vehiclesTable)
    .values({
      driverId: req.user!.userId,
      plate,
      model,
      brand,
      color,
      vehicleType,
      lateral: lateral ?? null,
    })
    .returning();

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
  });
});

export default router;
