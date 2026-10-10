import { describe, expect, it } from "vitest";
import { EgressNetworkController } from "./docker-network";

describe("isolated egress network", () => {
  it("places only the proxy on both internal and uplink networks", async () => {
    const commands: string[][] = [];
    const controller = new EgressNetworkController(
      `ghcr.io/powermesh/egress@sha256:${"a".repeat(64)}`,
      async (args) => {
        commands.push(args);
      },
    );
    const network = await controller.prepare("job-1", ["api.example.com"], {
      maxRequests: 10,
      maxBytes: 4096,
      timeoutMs: 1000,
    });
    expect(commands[0]).toContain("--internal");
    expect(commands[2]).toContain("--cap-drop=ALL");
    expect(commands[2]).toContain(`POWERMESH_ALLOWED_HOSTS=["api.example.com"]`);
    expect(commands[3]?.slice(0, 2)).toEqual(["network", "connect"]);
    expect(network.proxyIp.endsWith(".2")).toBe(true);
    expect(network.workloadIp.endsWith(".3")).toBe(true);
  });
});
