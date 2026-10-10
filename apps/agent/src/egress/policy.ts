import { BlockList, isIP } from "node:net";
import { domainToASCII } from "node:url";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export function normalizeHostname(input: string): string {
  const hostname = domainToASCII(input.trim().replace(/\.$/, "")).toLowerCase();
  if (!hostname || hostname.length > 253 || hostname.includes("..")) {
    throw new Error("INVALID_HOSTNAME");
  }
  return hostname;
}

const forbidden = new BlockList();
for (const [base, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  forbidden.addSubnet(base, prefix, "ipv4");
}
for (const [base, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  forbidden.addSubnet(base, prefix, "ipv6");
}

export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return forbidden.check(address, "ipv4");
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isForbiddenAddress(mapped);
    return forbidden.check(address, "ipv6");
  }
  return true;
}

export async function resolvePublicAddress(
  rawHostname: string,
  allowedHosts: ReadonlySet<string>,
  resolver: HostResolver,
): Promise<ResolvedAddress> {
  const hostname = normalizeHostname(rawHostname);
  if (!allowedHosts.has(hostname)) throw new Error("HOST_NOT_ALLOWED");
  if (isIP(hostname)) {
    if (isForbiddenAddress(hostname)) throw new Error("PRIVATE_ADDRESS_BLOCKED");
    return { address: hostname, family: isIP(hostname) };
  }
  const addresses = await resolver(hostname);
  if (addresses.length === 0) throw new Error("DNS_NO_RESULTS");
  if (addresses.some(({ address }) => isForbiddenAddress(address))) {
    throw new Error("DNS_PRIVATE_ADDRESS_BLOCKED");
  }
  return addresses[0] as ResolvedAddress;
}
