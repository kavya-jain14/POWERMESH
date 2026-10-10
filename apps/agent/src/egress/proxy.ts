import { lookup } from "node:dns/promises";
import http, { type IncomingHttpHeaders, type OutgoingHttpHeaders } from "node:http";
import net from "node:net";
import { type HostResolver, normalizeHostname, resolvePublicAddress } from "./policy";

export interface EgressProxyOptions {
  allowedHosts: string[];
  maxRequests: number;
  maxBytes: number;
  timeoutMs: number;
  resolver?: HostResolver;
}

function requestHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  return {
    accept: headers.accept,
    authorization: headers.authorization,
    "content-length": headers["content-length"],
    "content-type": headers["content-type"],
    "if-modified-since": headers["if-modified-since"],
    "if-none-match": headers["if-none-match"],
    "user-agent": headers["user-agent"],
    "accept-encoding": "identity",
  };
}

function responseHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  return {
    "cache-control": headers["cache-control"],
    "content-encoding": headers["content-encoding"],
    "content-length": headers["content-length"],
    "content-type": headers["content-type"],
    etag: headers.etag,
    expires: headers.expires,
    "last-modified": headers["last-modified"],
    location: headers.location,
  };
}

export function createEgressProxy(options: EgressProxyOptions): http.Server {
  const allowedHosts = new Set(options.allowedHosts.map(normalizeHostname));
  const resolver: HostResolver =
    options.resolver ??
    (async (hostname) =>
      (await lookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({
        address,
        family,
      })));
  let requests = 0;
  let bytes = 0;
  const consume = (amount: number) => {
    bytes += amount;
    if (bytes > options.maxBytes) throw new Error("EGRESS_BYTE_QUOTA_EXCEEDED");
  };
  const admit = () => {
    requests += 1;
    if (requests > options.maxRequests) throw new Error("EGRESS_REQUEST_QUOTA_EXCEEDED");
  };

  const server = http.createServer(async (request, response) => {
    try {
      admit();
      if (!request.url) throw new Error("INVALID_TARGET");
      const target = new URL(request.url);
      if (target.protocol !== "http:" || target.username || target.password || target.hash) {
        throw new Error("INVALID_TARGET");
      }
      const port = target.port ? Number(target.port) : 80;
      if (port !== 80) throw new Error("PORT_NOT_ALLOWED");
      const resolved = await resolvePublicAddress(target.hostname, allowedHosts, resolver);
      const upstream = http.request({
        host: resolved.address,
        family: resolved.family,
        port,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers: { ...requestHeaders(request.headers), host: normalizeHostname(target.hostname) },
        timeout: options.timeoutMs,
      });
      const deadline = setTimeout(
        () => upstream.destroy(new Error("UPSTREAM_DEADLINE")),
        options.timeoutMs,
      );
      deadline.unref();
      upstream.once("close", () => clearTimeout(deadline));
      upstream.on("response", (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          responseHeaders(upstreamResponse.headers),
        );
        upstreamResponse.on("data", (chunk: Buffer) => {
          try {
            consume(chunk.length);
            response.write(chunk);
          } catch {
            upstreamResponse.destroy();
            response.destroy();
          }
        });
        upstreamResponse.on("end", () => {
          clearTimeout(deadline);
          response.end();
        });
      });
      upstream.on("timeout", () => upstream.destroy(new Error("UPSTREAM_TIMEOUT")));
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      request.on("data", (chunk: Buffer) => {
        try {
          consume(chunk.length);
          upstream.write(chunk);
        } catch {
          upstream.destroy();
          request.destroy();
        }
      });
      request.on("end", () => upstream.end());
    } catch {
      response.writeHead(403, { "content-type": "text/plain" });
      response.end("Egress denied");
    }
  });

  server.on("connect", async (request, clientSocket, head) => {
    let upstream: net.Socket | undefined;
    try {
      admit();
      const target = new URL(`http://${request.url ?? ""}`);
      const port = target.port ? Number(target.port) : 443;
      if (port !== 443 || target.username || target.password) throw new Error("PORT_NOT_ALLOWED");
      const resolved = await resolvePublicAddress(target.hostname, allowedHosts, resolver);
      upstream = net.connect({ host: resolved.address, family: resolved.family, port });
      const deadline = setTimeout(() => {
        clientSocket.destroy();
        upstream?.destroy();
      }, options.timeoutMs);
      deadline.unref();
      upstream.once("close", () => clearTimeout(deadline));
      upstream.once("connect", () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) {
          consume(head.length);
          upstream?.write(head);
        }
      });
      const relay =
        (destination: { write(chunk: Buffer): boolean; destroy(): unknown }) => (chunk: Buffer) => {
          try {
            consume(chunk.length);
            destination.write(chunk);
          } catch {
            clientSocket.destroy();
            upstream?.destroy();
          }
        };
      clientSocket.on("data", relay(upstream));
      upstream.on("data", relay(clientSocket));
      clientSocket.on("end", () => upstream?.end());
      upstream.on("end", () => {
        clearTimeout(deadline);
        clientSocket.end();
      });
      upstream.on("error", () => clientSocket.destroy());
    } catch {
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      upstream?.destroy();
    }
  });

  return server;
}
