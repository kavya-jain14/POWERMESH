import { buildApp } from "./app";
import { createConfiguredStore } from "./store";

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "127.0.0.1";
const app = buildApp({ store: createConfiguredStore() });

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
