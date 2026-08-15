import { db } from "@workspace/db";
import { usersTable, subscriptionsTable } from "@workspace/db";
import { eq, and, gt, inArray } from "drizzle-orm";
import type { Server as IOServer } from "socket.io";
import { logger } from "../lib/logger.js";

const INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

/**
 * Periodic job: finds drivers who are online but whose subscription has expired,
 * forces them offline in the database, and notifies them via Socket.IO.
 */
async function runExpiryCheck(io: IOServer): Promise<void> {
  try {
    const now = new Date();

    // 1. All currently-online drivers
    const onlineDrivers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "driver"), eq(usersTable.isOnline, true)));

    if (onlineDrivers.length === 0) return;

    const driverIds = onlineDrivers.map((d) => d.id);

    // 2. Which of those have at least one non-expired subscription?
    const activeSubs = await db
      .select({ driverId: subscriptionsTable.driverId })
      .from(subscriptionsTable)
      .where(
        and(
          inArray(subscriptionsTable.driverId, driverIds),
          gt(subscriptionsTable.expiresAt, now),
        ),
      );

    const activeSet = new Set(activeSubs.map((s) => s.driverId));

    // 3. Drivers online with no active subscription → force offline
    const expiredIds = driverIds.filter((id) => !activeSet.has(id));

    if (expiredIds.length === 0) return;

    logger.info(
      { count: expiredIds.length, driverIds: expiredIds },
      "Forcing offline: drivers with expired subscriptions",
    );

    for (const driverId of expiredIds) {
      try {
        await db
          .update(usersTable)
          .set({ isOnline: false })
          .where(eq(usersTable.id, driverId));

        io.to(`user:${driverId}`).emit("driver:subscription_expired", {
          message:
            "Tu suscripción ha vencido. Has sido desconectado automáticamente. Contacta al administrador para renovar tu plan.",
        });

        logger.info({ driverId }, "Driver forced offline: expired subscription");
      } catch (err) {
        logger.error({ err, driverId }, "Failed to force driver offline");
      }
    }
  } catch (err) {
    logger.error({ err }, "subscriptionExpiryJob: unexpected error");
  }
}

/**
 * Starts the subscription-expiry cron job and returns the interval handle
 * so the caller can clear it on shutdown if needed.
 */
export function startSubscriptionExpiryJob(io: IOServer): NodeJS.Timeout {
  // Run immediately on startup so any already-expired online drivers are caught right away
  runExpiryCheck(io);
  return setInterval(() => runExpiryCheck(io), INTERVAL_MS);
}
