import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { DASHBOARD_STREAM_PATH } from "./routes/dashboard-stream.js";

const config = loadConfig();
const { app } = await buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { stream: `ws://localhost:${config.port}${DASHBOARD_STREAM_PATH}` },
    "consilium-live-dashboard ready",
  );
} catch (error) {
  app.log.error({ err: error }, "Failed to start consilium-live-dashboard");
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "Shutting down");
    void app.close().then(() => process.exit(0));
  });
}
