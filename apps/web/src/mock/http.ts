import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { ApiErrorBody } from "@/contracts-draft/types";
import type { MockUser } from "./seed";
import { assertOfflineDemoEnabled, MockApiError, userForRole } from "./store";

export const ROLE_COOKIE = "pm_role";

export async function currentUser(): Promise<MockUser> {
  const jar = await cookies();
  return userForRole(jar.get(ROLE_COOKIE)?.value);
}

function errorResponse(err: unknown): Response {
  const fallbackId = randomUUID();
  if (err instanceof MockApiError) {
    const body: ApiErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        fields: err.fields,
        details: err.details,
        correlationId: err.correlationId ?? fallbackId,
      },
    };
    return Response.json(body, { status: err.status });
  }
  console.error("[mock] unhandled", err);
  const body: ApiErrorBody = {
    error: {
      code: "INTERNAL",
      message: "Something went wrong on our side.",
      correlationId: fallbackId,
    },
  };
  return Response.json(body, { status: 500 });
}

/** Wraps a mock route: resolves the session, maps MockApiError → the Q8 error envelope. */
export async function handle<T>(
  fn: (user: MockUser) => T | Promise<T>,
  status = 200,
): Promise<Response> {
  try {
    assertOfflineDemoEnabled();
    const user = await currentUser();
    const result = await fn(user);
    return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new MockApiError(400, "VALIDATION_FAILED", "Request body must be JSON.");
  }
}

export { errorResponse };
