import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error("DATABASE_URL is required in production. Ensure the database is provisioned and DATABASE_URL is set.");
  } else {
    // In development or CI we avoid throwing at import time so tooling that reads schema can still run.
    // Operations that actually connect should still validate presence of DATABASE_URL.
    // eslint-disable-next-line no-console
    console.warn('DATABASE_URL is not set; drizzle config will be created but DB connections may fail if used.');
  }
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
