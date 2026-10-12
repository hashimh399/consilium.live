import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import type { Config } from "./config.js";
import { DashboardHub } from "./realtime/hub.js";
import {
  startRedisSubscriber,
  type RedisSubscriber,
} from "./realtime/redis-subscriber.js";
import { registerCallRoutes } from "./routes/calls.js";
import { registerDashboardStream } from "./routes/dashboard-stream.js";
import { registerHome } from "./routes/home.js";
import { CallStore } from "./store/call-store.js";

export interface App {
  app: FastifyInstance;
  store: CallStore;
  hub: DashboardHub;
}

export interface BuildOptions {
  /** Skip the Redis subscriber — used by tests and offline demos. */
  withRedis?: boolean;
}

export async function buildApp(
  config: Config,
  options: BuildOptions = {},
): Promise<App> {
  const { withRedis = true } = options;

  const app = Fastify({
    logger: { level: config.logLevel },
  });

  const store = new CallStore();
  const hub = new DashboardHub();

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });
  await app.register(websocket);

  await app.register(async (instance) => {
    await registerHome(instance);
    await registerCallRoutes(instance, { store, hub });
    await registerDashboardStream(instance, { store, hub });
  });

  let subscriber: RedisSubscriber | null = null;
  if (withRedis) {
    subscriber = startRedisSubscriber({ config, store, hub, log: app.log });
  }

  app.addHook("onClose", async () => {
    hub.closeAll();
    if (subscriber) await subscriber.close();
  });

  return { app, store, hub };
}
