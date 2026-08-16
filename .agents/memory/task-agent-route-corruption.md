---
name: Task-agent route corruption in trips.ts
description: Merged task-agent work has repeatedly mangled Express route bodies; how to detect and recover.
---

Merged task-agent branches have several times corrupted `artifacts/api-server/src/routes` files: route bodies swapped between handlers, routes renamed to the wrong method/path (e.g. the PATCH /:id/status body registered as POST /:id/rating), inserts deleted leaving references to undefined vars (`tripId`, `updated`, `price`).

**Why:** merge reconciliation appears to splice handler bodies incorrectly; TS type-check doesn't run in CI so it ships silently and only fails at runtime with `ReferenceError`.

**How to apply:** after any task merge touching api-server routes, grep for `router.(get|post|patch)` and confirm each handler body matches its path; check server logs for ReferenceError. Recover known-good bodies from git history (`git show <old-commit>:path`) — commit `5c52512` era had the last fully-intact trips.ts.

Also: mobile SocketContext emits `join:trip`/`leave:trip` (colon), server historically listened for `join_trip`/`leave_trip` — server now registers both aliases; keep both if touching index.ts.
