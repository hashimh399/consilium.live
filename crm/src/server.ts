import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { lookup: `http://localhost:${config.port}/api/caller-lookup` },
    "consilium-crm ready",
  );
} catch (error) {
  app.log.error({ err: error }, "Failed to start consilium-crm");
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "Shutting down");
    void app.close().then(() => process.exit(0));
  });
}
