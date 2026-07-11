import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/schema/kernel.ts",
    "./src/schema/identity.ts",
    "./src/schema/directory.ts",
    "./src/schema/search.ts",
    "./src/schema/scheduling.ts",
    "./src/schema/booking.ts",
  ],
  out: "./migrations",
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
  // Only `db:migrate`/`db:studio` need credentials; `db:generate` is offline.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/mesomed",
  },
});
