---
name: Vehicle lateral column reserved word
description: "lateral" is a SQL reserved word; must be double-quoted in raw PostgreSQL DDL.
---

## Rule
When writing raw SQL DDL that includes the `lateral` column from `vehiclesTable`, always quote it:

```sql
"lateral" TEXT
```

NOT:
```sql
lateral TEXT  -- syntax error
```

**Why:** LATERAL is a reserved keyword in SQL (used for LATERAL JOINs). PostgreSQL rejects it as an unquoted column name.

**How to apply:** Drizzle ORM handles this automatically in queries (it always quotes identifiers). Only affects hand-written DDL/migrations.
