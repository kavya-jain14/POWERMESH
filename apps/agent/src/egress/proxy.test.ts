import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createEgressProxy } from "./proxy";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});

describe("controlled egress proxy", () => {
  it("denies non-allowlisted destinations before connecting", async () => {
    const proxy = createEgressProxy({
      allowedHosts: ["api.example.com"],
      maxRequests: 5,
      maxBytes: 1024,
      timeoutMs: 1000,
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    servers.push(proxy);
    await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("proxy did not bind");
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = http.request(
        { host: "127.0.0.1", port: address.port, path: "http://evil.test/data" },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(status).toBe(403);
  });

  it("blocks private DNS answers for an allowlisted hostname", async () => {
    const proxy = createEgressProxy({
      allowedHosts: ["api.example.com"],
      maxRequests: 5,
      maxBytes: 1024,
      timeoutMs: 1000,
      resolver: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    servers.push(proxy);
    await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("proxy did not bind");
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = http.request(
        { host: "127.0.0.1", port: address.port, path: "http://api.example.com/data" },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(status).toBe(403);
  });
});
