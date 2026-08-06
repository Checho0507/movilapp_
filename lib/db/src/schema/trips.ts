import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tripsTable = pgTable("trips", {
  id: serial("id").primaryKey(),
  passengerId: integer("passenger_id").notNull(),
  driverId: integer("driver_id"),
  status: text("status").notNull().default("pending"),
  originLat: numeric("origin_lat").notNull(),
  originLng: numeric("origin_lng").notNull(),
  originAddress: text("origin_address").notNull(),
  destinationLat: numeric("destination_lat").notNull(),
  destinationLng: numeric("destination_lng").notNull(),
  destinationAddress: text("destination_address").notNull(),
  vehicleType: text("vehicle_type").notNull().default("taxi"),
  estimatedPrice: numeric("estimated_price").notNull().default("0"),
  finalPrice: numeric("final_price"),
  /** Precio real reportado voluntariamente por el pasajero al finalizar el viaje */
  actualPrice: numeric("actual_price"),
  distanceKm: numeric("distance_km"),
  paymentMethod: text("payment_method").notNull().default("cash"),
  cancelReason: text("cancel_reason"),
  /** Momento en que el conductor aceptó el viaje — base del temporizador de 4 min */
  driverAcceptedAt: timestamp("driver_accepted_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTripSchema = createInsertSchema(tripsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTrip = z.infer<typeof insertTripSchema>;
export type Trip = typeof tripsTable.$inferSelect;
