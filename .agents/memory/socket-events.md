---
name: Socket event name contract
description: The server must emit BOTH the generic event and the status-specific event so all screens receive real-time updates.
---

## Trip status updates
- Server emits to `trip:{tripId}` room:
  - `trip_status_updated` (generic — home screen uses this while searching)
  - `trip:{status}` e.g. `trip:accepted`, `trip:driver_arriving`, `trip:in_progress`, `trip:completed`, `trip:cancelled` (trip detail screen uses these)
- Server also emits `trip_status_updated` to `user:{passengerId}` and `user:{driverId}`

## Messages in a trip
- Client (`trip/[id].tsx`) listens for `message:new`
- Server must emit `message:new` (not `new_message`)

## Driver location
- Client listens for `driver:location`  
- Server must emit to `driver:{driverId}` room AND `trip:{activeTrip.id}` room
- Look up driver's active trip (status IN accepted, driver_arriving, in_progress) before emitting

## Auto-cancel (scheduleRetries)
- Also emit `trip:cancelled` to `trip:{tripId}` room when auto-cancelling

**Why:** Client code uses specific event names that differ from what was originally emitted on the server side.
