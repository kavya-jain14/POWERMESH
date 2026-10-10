import { describe, expect, it } from "vitest";
import { isForbiddenAddress, normalizeHostname, resolvePublicAddress } from "./policy";

describe("egress address policy", () => {
  it("normalizes exact internationalized hostnames without wildcard matching", () => {
    expect(normalizeHostname("BÜCHER.example.")).toBe("xn--bcher-kva.example");
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.31.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("blocks non-public address %s", (address) => {
    expect(isForbiddenAddress(address)).toBe(true);
  });

  it("blocks an entire DNS answer set if any answer is private", async () => {
    await expect(
      resolvePublicAddress("api.example.com", new Set(["api.example.com"]), async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow(/PRIVATE/);
  });

  it("rejects suffix tricks and returns only a newly resolved public IP", async () => {
    const resolver = async () => [{ address: "93.184.216.34", family: 4 }];
    await expect(
      resolvePublicAddress("api.example.com.attacker.test", new Set(["api.example.com"]), resolver),
    ).rejects.toThrow(/NOT_ALLOWED/);
    await expect(
      resolvePublicAddress("api.example.com", new Set(["api.example.com"]), resolver),
    ).resolves.toMatchObject({ address: "93.184.216.34" });
  });
});
