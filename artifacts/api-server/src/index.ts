import { createServer } from "http";
import { Server as IOServer } from "socket.io";
import app from "./app.js";
import { initIO } from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { startSubscriptionExpiryJob } from "./jobs/subscriptionExpiry.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

const io = new IOServer(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST", "PATCH", "DELETE"] },
  path: "/api/socket.io",
});

initIO(io);
startSubscriptionExpiryJob(io);

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Socket connected");

  // Client joins their personal room to receive targeted events
  socket.on("join_user", (userId: number) => {
    socket.join(`user:${userId}`);
    logger.info({ userId, socketId: socket.id }, "User joined personal room");
  });

  // Client joins a trip room (passenger + driver both join)
  // Accept both event spellings — the mobile client emits "join:trip"
  const joinTrip = (tripId: number) => {
    socket.join(`trip:${tripId}`);
    logger.info({ tripId, socketId: socket.id }, "Joined trip room");
  };
  socket.on("join_trip", joinTrip);
  socket.on("join:trip", joinTrip);

  // Driver location broadcasting room (passengers subscribe to driver)
  socket.on("watch_driver", (driverId: number) => {
    socket.join(`driver:${driverId}`);
  });

  const leaveTrip = (tripId: number) => {
    socket.leave(`trip:${tripId}`);
  };
  socket.on("leave_trip", leaveTrip);
  socket.on("leave:trip", leaveTrip);

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Socket disconnected");
  });
});

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
});
