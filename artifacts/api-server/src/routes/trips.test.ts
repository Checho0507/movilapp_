import assert from "node:assert/strict";
import test from "node:test";

import { resolveTripDestination } from "./trips.js";
import { signToken, verifyToken } from "../lib/auth.js";

test("signToken and verifyToken round-trip valid payloads", () => {
  const token = signToken({ userId: 42, role: "driver" });
  assert.deepEqual(verifyToken(token), { userId: 42, role: "driver" });
});

test("verifyToken rejects malformed payloads", () => {
  assert.throws(() => verifyToken("not-a-jwt"), /jwt|token/i);
});

test("resolveTripDestination keeps explicit destination data and marks pending when destination is missing", () => {
  const explicit = resolveTripDestination({
    originLat: 4.65,
    originLng: -74.1,
    destinationLat: 4.661,
    destinationLng: -74.09,
    destinationAddress: "Carrera 42a #11a09, Estambul",
    originAddress: "Carrera 9 #9a07, Chipre",
  });

  assert.equal(explicit.hasDestination, true);
  assert.equal(explicit.destinationPending, false);
  assert.equal(explicit.finalDestinationAddress, "Carrera 42a #11a09, Estambul");

  const missing = resolveTripDestination({
    originLat: 4.65,
    originLng: -74.1,
    destinationAddress: "",
    originAddress: "Carrera 9 #9a07, Chipre",
  });

  assert.equal(missing.hasDestination, false);
  assert.equal(missing.destinationPending, true);
  assert.equal(missing.finalDestinationAddress, "Carrera 9 #9a07, Chipre");
  assert.equal(missing.finalDestinationLat, 4.65);
  assert.equal(missing.finalDestinationLng, -74.1);
});

test("resolveTripDestination treats same-origin destination as pending but valid fallback", () => {
  const result = resolveTripDestination({
    originLat: 4.65,
    originLng: -74.1,
    destinationLat: 4.65,
    destinationLng: -74.1,
    destinationAddress: "Carrera 9 #9a07, Chipre",
    originAddress: "Carrera 9 #9a07, Chipre",
  });

  assert.equal(result.hasDestination, false);
  assert.equal(result.destinationPending, true);
  assert.equal(result.finalDestinationAddress, "Carrera 9 #9a07, Chipre");
});
