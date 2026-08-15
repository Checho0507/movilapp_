---
name: Vehicle trial logic — plate-based eligibility
description: Trial subscription is granted at vehicle registration (not account creation), tied to the plate to prevent abuse.
---

## Rule
Trial (60 days) is granted inside `POST /api/vehicles`, NOT at `POST /api/auth/register`.

## Eligibility checks (all must pass)
1. Driver must NOT already have any subscription (no double-trial for same account)
2. The plate must NOT have been previously registered to a DIFFERENT driver who already received a trial

## Plate normalization
All plates are uppercased (`plate.trim().toUpperCase()`) before insert and lookup — prevents "tax001" vs "TAX001" bypass.

## Response shape
`POST /vehicles` returns `{ ...vehicle, trial: { granted: boolean, reason?: string } }`
- `reason: "already_subscribed"` → driver already has a subscription
- `reason: "plate_trial_used"` → plate was previously registered to an account that used a trial

## Duplicate plate guard
Same driver trying to register the same plate twice → HTTP 409 "You already have this vehicle registered"

**Why:** A driver could create a new phone number to bypass a 2-month trial. Tying eligibility to the plate (which is government-assigned and hard to change) prevents this. Legitimate plate transfers are allowed (new owner can register the plate) but don't get a new trial.

**How to apply:** Any change to trial grant logic must go through `artifacts/api-server/src/routes/vehicles.ts`, not `auth.ts`.
