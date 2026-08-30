import assert from "node:assert/strict";
import test from "node:test";

import { isValidPassword, normalizePhone, sanitizeAcceptedPayments } from "./auth.js";

test("normalizePhone strips formatting while keeping the country code digits", () => {
  assert.equal(normalizePhone("+57 (300) 123-4567"), "573001234567");
  assert.equal(normalizePhone(" 300 123 4567 "), "3001234567");
  assert.equal(normalizePhone("abc"), "");
});

test("isValidPassword enforces the minimum length required by the app", () => {
  assert.equal(isValidPassword("12345"), false);
  assert.equal(isValidPassword("123456"), true);
  assert.equal(isValidPassword(undefined), false);
});

test("sanitizeAcceptedPayments only preserves valid driver payment methods", () => {
  assert.deepEqual(sanitizeAcceptedPayments("driver", ["nequi", "efectivo", "daviplata"]), ["nequi", "daviplata"]);
  assert.deepEqual(sanitizeAcceptedPayments("passenger", ["nequi", "daviplata"]), []);
  assert.deepEqual(sanitizeAcceptedPayments("driver", undefined), []);
});
