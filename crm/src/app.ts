import Fastify, { LogController, type FastifyInstance } from "fastify";

import { lookupCaller } from "./directory.js";
import type { Config } from "./config.js";

export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.get("/health", async () => ({ status: "ok", service: "consilium-crm" }));

  app.get<{ Querystring: { ani?: string } }>(
    "/api/caller-lookup",
    (request) => {
      const ani = request.query.ani?.trim() ?? "";
      const result = ani === "" ? lookupCaller("") : lookupCaller(ani);
      if (result.status === "success") {
        request.log.info(
          { ani, name: result.data.name, source: result.source },
          "lookup success",
        );
      }
      return result;
    },
  );

  return app;
}
