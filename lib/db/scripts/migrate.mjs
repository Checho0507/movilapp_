import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set before running database migrations.");
}

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const migrationFiles = (await readdir(migrationDirectory))
  .filter((name) => /^\d{8}_[a-z0-9_]+\.sql$/i.test(name))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error(`No SQL migrations found in ${migrationDirectory}`);
}

const pool = new pg.Pool({ connectionString });

try {
  for (const migrationFile of migrationFiles) {
    const migrationSql = await readFile(resolve(migrationDirectory, migrationFile), "utf8");
    console.info(`Applying database migration ${migrationFile}`);
    await pool.query(migrationSql);
  }
} finally {
  await pool.end();
}
