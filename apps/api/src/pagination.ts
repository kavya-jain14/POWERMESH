import { z } from "zod";
import type { JobListCursor } from "./store/types";

const jobListCursorSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

export function encodeJobCursor(cursor: JobListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeJobCursor(cursor: string): JobListCursor | null {
  try {
    return jobListCursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}
