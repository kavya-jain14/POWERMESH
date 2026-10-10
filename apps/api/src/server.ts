import { buildApp } from "./app";
import { createOfferSigner } from "./offers/signing";
import { createConfiguredStore } from "./store";

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "127.0.0.1";
const encodedPrivateKey = process.env.OFFER_SIGNING_PRIVATE_KEY_BASE64;
const coordinatorKey = process.env.POWERMESH_COORDINATOR_KEY;
const enrollmentKey = process.env.POWERMESH_ENROLLMENT_KEY;

if (
  process.env.NODE_ENV === "production" &&
  (!encodedPrivateKey || !coordinatorKey || !enrollmentKey)
) {
  throw new Error(
    "OFFER_SIGNING_PRIVATE_KEY_BASE64, POWERMESH_COORDINATOR_KEY, and POWERMESH_ENROLLMENT_KEY are required in production",
  );
}

const offerSigner = createOfferSigner(
  encodedPrivateKey ? Buffer.from(encodedPrivateKey, "base64").toString("utf8") : undefined,
);
const app = buildApp({
  store: createConfiguredStore(),
  offerSigner,
  coordinatorKey,
  enrollmentKey,
});

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
