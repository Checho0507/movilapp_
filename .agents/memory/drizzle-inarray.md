---
name: Drizzle inArray vs raw SQL ANY(ARRAY[...])
description: Using raw sql template literals to build ANY(ARRAY[$1]) with parameterized ints fails; use inArray() instead.
---

## Problem
```typescript
// BAD — generates ANY(ARRAY[$1]) with $1 = integer, which PostgreSQL rejects
sql`${vehiclesTable.driverId} = ANY(ARRAY[${sql.join(ids.map(id => sql`${id}`), sql`, `)}])`
```

## Fix
```typescript
import { inArray } from "drizzle-orm";
// GOOD — generates the correct parameterized form
inArray(vehiclesTable.driverId, driverIds)
```

**Why:** Drizzle's sql`` template tag parameterizes each embedded value. When building ARRAY[] this way, PostgreSQL receives `ANY(ARRAY[$1])` where $1 is a single integer — not an array — and rejects it.

**How to apply:** Whenever filtering by a list of IDs, use `inArray(column, ids)` from drizzle-orm instead of raw SQL.
