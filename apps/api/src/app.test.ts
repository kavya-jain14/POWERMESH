import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("coordinator API", () => {
  it("reports health", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "powermesh-api" });
    await app.close();
  });

  it("blocks a workload asking for the Docker socket", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/risk/classify",
      payload: {
        cpu: 1,
        memoryMb: 256,
        timeoutSeconds: 60,
        networkMode: "OFFLINE",
        needsHostMount: false,
        privileged: false,
        dockerSocket: true,
        deviceAccess: false,
        arbitraryImage: false,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().tier).toBe("BLOCKED");
    await app.close();
  });
});
