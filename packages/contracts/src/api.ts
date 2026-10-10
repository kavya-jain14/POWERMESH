import { z } from "zod";

export const apiErrorCodes = [
  "VALIDATION_FAILED",
  "RISK_BLOCKED",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "FORBIDDEN",
  "CONFLICT",
  "OFFER_EXPIRED",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "UNAVAILABLE",
  "INTERNAL",
] as const;

export const apiErrorCodeSchema = z.enum(apiErrorCodes);

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().trim().min(1).max(500),
    fields: z.record(z.string().min(1), z.string().max(500)).optional(),
    correlationId: z.string().uuid(),
    details: z.unknown().optional(),
  }),
});

export const opaqueCursorSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: opaqueCursorSchema.optional(),
});

export function pageSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: opaqueCursorSchema.nullable(),
  });
}

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
export type Page<T> = { items: T[]; nextCursor: string | null };
