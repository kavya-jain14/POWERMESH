import { createPostgresPool } from "../db/pool";
import { MemoryCoordinatorStore } from "./memory";
import { PostgresCoordinatorStore } from "./postgres";
import type { CoordinatorStore } from "./types";

export * from "./memory";
export * from "./postgres";
export * from "./types";

export function createConfiguredStore(): CoordinatorStore {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return new MemoryCoordinatorStore();
  return new PostgresCoordinatorStore(createPostgresPool(connectionString));
}
