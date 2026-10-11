import { readFile } from "node:fs/promises";
import path from "node:path";
import { errorResponse } from "@/mock/http";
import { assertOfflineDemoEnabled, resolveArtifact } from "@/mock/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Raster types that may render inline. Everything else is download-only (G1 §3.6). */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  try {
    assertOfflineDemoEnabled();
    const { artifact, file } = resolveArtifact(id, url.searchParams.get("exp"), url.searchParams.get("sig"));
    const bytes = await readFile(path.join(process.cwd(), "mock-artifacts", path.basename(file)));
    const download = url.searchParams.get("download") === "1" || !INLINE_TYPES.has(artifact.contentType);
    const safeName = artifact.name.replace(/[^\w.-]/g, "_");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
