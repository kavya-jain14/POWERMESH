import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateOutput } from "./output-validator";

describe("sandbox output validation", () => {
  it("accepts safe JSON and returns its digest", () => {
    const data = Buffer.from('{"ok":true}');
    expect(validateOutput("result.json", "application/json", data, 100)).toEqual({
      filename: "result.json",
      contentType: "application/json",
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  });

  it("accepts a WebP signature", () => {
    const data = Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP");
    expect(validateOutput("result.webp", "image/webp", data, 100).contentType).toBe("image/webp");
  });

  it("rejects traversal, active content, oversized files, and spoofed magic bytes", () => {
    expect(() => validateOutput("../secret", "text/plain", Buffer.from("x"), 10)).toThrow(
      /filename/,
    );
    expect(() =>
      validateOutput("result.txt", "text/plain", Buffer.from("<svg onload=alert(1)>"), 100),
    ).toThrow(/Active content/);
    expect(() => validateOutput("big.txt", "text/plain", Buffer.alloc(11), 10)).toThrow(/size/);
    expect(() => validateOutput("fake.png", "image/png", Buffer.from("not png"), 100)).toThrow(
      /signature/,
    );
    expect(() => validateOutput("archive.zip", "application/zip", Buffer.from("PK"), 100)).toThrow(
      /not allowed/,
    );
    expect(() =>
      validateOutput(
        "active.pdf",
        "application/pdf",
        Buffer.from("%PDF-1.7\n1 0 obj <</OpenAction 2 0 R>>"),
        100,
      ),
    ).toThrow(/active/);
  });
});
