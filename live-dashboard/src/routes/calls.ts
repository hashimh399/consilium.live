import type { FastifyInstance } from "fastify";

import { applyEvent } from "../realtime/apply-event.js";
import type { DashboardHub } from "../realtime/hub.js";
import type { CallStore } from "../store/call-store.js";
import { parseVoiceAgentEvent } from "../types.js";

export interface CallsRouteDeps {
  store: CallStore;
  hub: DashboardHub;
}

export async function registerCallRoutes(
  app: FastifyInstance,
  deps: CallsRouteDeps,
): Promise<void> {
  const { store, hub } = deps;

  app.get("/health", async () => ({
    status: "ok",
    calls: store.size(),
    dashboardClients: hub.size,
  }));

  app.get("/api/v1/calls", async () => ({ calls: store.list() }));

  app.get<{ Params: { callSid: string } }>(
    "/api/v1/calls/:callSid",
    async (request, reply) => {
      const call = store.get(request.params.callSid);
      if (!call) return reply.code(404).send({ error: "Call not found" });
      return call;
    },
  );

  /**
   * Inject an event exactly as Redis would deliver it. Lets the dashboard be
   * demoed and tested without a Redis server running.
   */
  app.post("/api/v1/events", async (request, reply) => {
    const event = parseVoiceAgentEvent(JSON.stringify(request.body));
    if (event === null) {
      return reply
        .code(400)
        .send({ error: "Expected { callSid, type, data } with a known type" });
    }

    const call = applyEvent(store, event);
    if (call === null) {
      return reply.code(422).send({ error: "Event carried no usable data" });
    }

    hub.broadcastCall(call);
    return { accepted: true, call };
  });
}
