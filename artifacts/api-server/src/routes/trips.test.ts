import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateEconomicalFare,
  MIN_FARE_COP,
  resolveTripDestination,
  validateFare,
} from "./trips.js";
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

test("economical fares keep the floor and round automatic values to thousands", () => {
  assert.equal(calculateEconomicalFare(0), MIN_FARE_COP);
  assert.equal(calculateEconomicalFare(1) % 1000, 0);
  assert.ok(calculateEconomicalFare(10) >= MIN_FARE_COP);
});

test("negotiated fares require 500-peso increments and cannot go below the minimum", () => {
  assert.equal(validateFare(6500, 5500), 6500);
  assert.throws(() => validateFare(6250, 5500), /múltiplo/);
  assert.throws(() => validateFare(5000, 5500), /no menor/);
});
