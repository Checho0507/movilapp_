import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import tripsRouter, { setIO as setTripsIO } from "./trips.js";
import driversRouter, { setIO as setDriversIO } from "./drivers.js";
import vehiclesRouter from "./vehicles.js";
import adminRouter from "./admin.js";
import conversationsRouter, { setIO as setConversationsIO } from "./conversations.js";
import type { Server as IOServer } from "socket.io";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/trips", tripsRouter);
router.use("/drivers", driversRouter);
router.use("/vehicles", vehiclesRouter);
router.use("/admin", adminRouter);
router.use("/conversations", conversationsRouter);

export function initIO(io: IOServer) {
  setTripsIO(io);
  setDriversIO(io);
  setConversationsIO(io);
}

export default router;
