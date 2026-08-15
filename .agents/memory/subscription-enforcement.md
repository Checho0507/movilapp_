---
name: Subscription enforcement
description: Three server-side gates block drivers with expired or missing subscriptions. Client already handles the error code.
---

## Gates (all in server)

| Route | Condition | Response |
|---|---|---|
| `PATCH /api/drivers/status` | `isOnline: true` with no active sub | HTTP 403 + `code: "SUBSCRIPTION_REQUIRED"` |
| `PATCH /api/trips/:id/status` | `status: "accepted"` with no active sub | HTTP 403 + `code: "SUBSCRIPTION_REQUIRED"` |
| Going offline (`isOnline: false`) | Never blocked | Always HTTP 200 |

## Active subscription check
```typescript
const [activeSub] = await db
  .select({ id: subscriptionsTable.id })
  .from(subscriptionsTable)
  .where(and(
    eq(subscriptionsTable.driverId, driverId),
    gt(subscriptionsTable.expiresAt, new Date()),  // expiresAt > NOW()
  ))
  .limit(1);
```
Requires `gt` from drizzle-orm (already imported in both drivers.ts and trips.ts).

## Client handling (index.tsx DriverHome)
`toggleOnline` catch block already checks `err?.code === 'SUBSCRIPTION_REQUIRED'` and shows the correct Alert. `handleAccept` shows `e?.data?.error` which carries the server message.

## Profile UI (profile.tsx)
- Driver with active sub → `SubscriptionCard` (shows days remaining, plan)
- Driver with expired sub → `SubscriptionCard` with red "Vencida" badge + renewal banner
- Driver with NO sub (hasn't registered vehicle) → amber "Sin suscripción activa" card explaining vehicle registration + 60-day trial

**Why:** Drivers with expired subscriptions could still accept trips and go online before these gates were added. Tying enforcement to the server (not just the UI) prevents bypass.
