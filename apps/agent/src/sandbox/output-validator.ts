import { createHash } from "node:crypto";

const ALLOWED_TYPES = new Set([
  "application/json",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

export interface ValidatedOutput {
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
}

function hasPrefix(data: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => data[index] === byte);
}

export function validateOutput(
  filename: string,
  contentType: string,
  data: Buffer,
  maxBytes: number,
): ValidatedOutput {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error("Output size limit must be a nonnegative safe integer");
  }
  const hasUnsafeCharacter = [...filename].some(
    (character) => character === "/" || character === "\\" || character.charCodeAt(0) < 32,
  );
  if (!filename || filename === "." || filename === ".." || hasUnsafeCharacter) {
    throw new Error("Unsafe output filename");
  }
  if (!ALLOWED_TYPES.has(contentType)) throw new Error("Output content type is not allowed");
  if (data.length > maxBytes) throw new Error("Output exceeds the configured size limit");

  if (contentType === "application/pdf" && !hasPrefix(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw new Error("PDF signature does not match its content type");
  }
  if (
    contentType === "application/pdf" &&
    /\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|RichMedia)\b/i.test(
      data.toString("latin1"),
    )
  ) {
    throw new Error("PDF contains active or embedded content");
  }
  if (
    contentType === "image/png" &&
    !hasPrefix(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    throw new Error("PNG signature does not match its content type");
  }
  if (contentType === "image/jpeg" && !hasPrefix(data, [0xff, 0xd8, 0xff])) {
    throw new Error("JPEG signature does not match its content type");
  }
  if (
    contentType === "image/webp" &&
    (!hasPrefix(data, [0x52, 0x49, 0x46, 0x46]) ||
      data.subarray(8, 12).toString("ascii") !== "WEBP")
  ) {
    throw new Error("WebP signature does not match its content type");
  }
  if (contentType === "application/json") JSON.parse(data.toString("utf8"));
  if (contentType === "text/plain") {
    const sample = data.subarray(0, 1024).toString("utf8").trimStart().toLowerCase();
    if (
      sample.startsWith("<html") ||
      sample.startsWith("<!doctype html") ||
      sample.startsWith("<svg")
    ) {
      throw new Error("Active content cannot be returned as text");
    }
  }

  return {
    filename,
    contentType,
    size: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}
