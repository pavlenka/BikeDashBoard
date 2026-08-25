import path from "node:path";
import { fileURLToPath } from "node:url";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import Fastify from "fastify";

import { registerActivityRoutes } from "./activities.js";
import { registerAnalyticsRoutes } from "./analytics.js";
import { registerAuthRoutes } from "./auth.js";
import { scheduleBackups } from "./backup.js";
import { config } from "./config.js";
import { registerHealthAutoExportRoutes } from "./healthAutoExport.js";

const app = Fastify({
  logger: {
    level: config.isProduction ? "info" : "debug",
  },
  bodyLimit: 50 * 1024 * 1024,
  trustProxy: config.isProduction,
});

await app.register(cookie);
await app.register(rateLimit, {
  max: 180,
  timeWindow: "1 minute",
  allowList: ["127.0.0.1", "::1"],
});
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https://tile.openstreetmap.org"],
      connectSrc: ["'self'", "https://tile.openstreetmap.org"],
      workerSrc: ["'self'", "blob:"],
      fontSrc: ["'self'"],
    },
  },
});

app.addHook("onRequest", async (request, reply) => {
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "OPTIONS" &&
    request.url.startsWith("/api/")
  ) {
    const origin = request.headers.origin;
    if (origin && origin !== config.rpOrigin) {
      return reply.code(403).send({ error: "invalid_origin" });
    }
  }
});

app.get("/healthz", async () => ({ status: "ok" }));
await registerAuthRoutes(app);
await registerActivityRoutes(app);
await registerAnalyticsRoutes(app);
await registerHealthAutoExportRoutes(app);

if (config.isProduction) {
  const clientRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../client",
  );
  await app.register(staticPlugin, { root: clientRoot });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
    return reply.sendFile("index.html");
  });
}

scheduleBackups(app.log);

await app.listen({ port: config.port, host: config.host });
