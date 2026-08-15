---
name: DB schema corrections
description: The original SQL migrations differed from the Drizzle ORM schema. Correct column names for messages, ratings, vehicles, and conversations.
---

## What was wrong vs. what Drizzle expects

| Table | Wrong column | Correct column |
|---|---|---|
| messages | conversation_id | trip_id |
| ratings | rated_id | ratee_id |
| vehicles | year, type, is_active, updated_at | lateral (TEXT, nullable), vehicle_type |
| conversations | trip_id, passenger_id, driver_id | user_id, other_user_id, type, subject, status |

## Extra tables needed (not in original migration)
- `conversation_messages` (id, conversation_id, sender_id, content, created_at)

**Why:** The original SQL was hand-written and drifted from the Drizzle schema definitions in `lib/db/src/schema/`.

**How to apply:** Always derive migrations from `lib/db/src/schema/*.ts` files (the Drizzle source of truth), not from hand-written SQL. If in doubt, use `executeSql` to check `information_schema.columns`.
