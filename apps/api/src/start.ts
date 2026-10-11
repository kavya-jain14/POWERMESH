if (process.env.DATABASE_URL) {
  await import("./db/migrate");
}

await import("./server");

export {};
