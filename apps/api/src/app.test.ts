import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("coordinator API", () => {
  it("reports health", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "powermesh-api",
      storage: "memory",
    });
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

  it("submits a bounded job after policy classification", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      payload: {
        requesterId: "11111111-1111-4111-8111-111111111111",
        workload: {
          name: "image-resize",
          version: "1.0.0",
          imageDigest: `sha256:${"a".repeat(64)}`,
        },
        resources: {
          cpu: 1,
          memoryMb: 256,
          timeoutSeconds: 60,
          networkMode: "OFFLINE",
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().job.state).toBe("POLICY_CHECKED");
    expect(response.json().risk.tier).toBe("LOW");
    await app.close();
  });

  it("keeps open-web jobs outside the MVP", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      payload: {
        requesterId: "11111111-1111-4111-8111-111111111111",
        workload: {
          name: "web-crawler",
          version: "1.0.0",
          imageDigest: `sha256:${"b".repeat(64)}`,
        },
        resources: {
          cpu: 1,
          memoryMb: 256,
          timeoutSeconds: 60,
          networkMode: "OPEN_WEB",
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().risk.tier).toBe("HIGH");
    await app.close();
  });

  it("registers a provider and accepts its heartbeat", async () => {
    const app = buildApp();
    const registration = await app.inject({
      method: "POST",
      url: "/v1/nodes/register",
      payload: {
        ownerId: "22222222-2222-4222-8222-222222222222",
        nodeName: "kavya-mac",
        os: "darwin",
        architecture: "arm64",
        agentVersion: "0.1.0",
        cpuCores: 10,
        memoryMb: 16384,
        networkModes: ["OFFLINE", "RESTRICTED"],
        isolationLevels: ["CONTAINER_BASELINE"],
      },
    });

    expect(registration.statusCode).toBe(201);
    const nodeId = registration.json().node.id;
    const heartbeat = await app.inject({
      method: "POST",
      url: `/v1/nodes/${nodeId}/heartbeat`,
      payload: {
        availableCpu: 8,
        availableMemoryMb: 12000,
        activeJobs: 1,
        status: "ONLINE",
      },
    });

    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json().node.status).toBe("ONLINE");
    expect(heartbeat.json().node.lastHeartbeatAt).toBeTruthy();
    await app.close();
  });
});
