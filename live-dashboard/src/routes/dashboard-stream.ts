import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

import type { CallStore } from "../store/call-store.js";
import type { DashboardHub } from "../realtime/hub.js";

export const DASHBOARD_STREAM_PATH = "/api/v1/stream/dashboard";

export interface StreamRouteDeps {
  store: CallStore;
  hub: DashboardHub;
}

/**
 * Live dashboard feed.
 *
 * A client receives one `snapshot` frame on connect, then a `call.update`
 * frame every time a call changes. The socket is read-only apart from an
 * optional `{"type":"refresh"}` request for a fresh snapshot.
 */
export async function registerDashboardStream(
  app: FastifyInstance,
  deps: StreamRouteDeps,
): Promise<void> {
  const { store, hub } = deps;

  app.get(
    DASHBOARD_STREAM_PATH,
    { websocket: true },
    (socket: WebSocket, request) => {
      hub.add(socket);
      hub.snapshot(socket, store.list());
      request.log.info(
        { clients: hub.size, calls: store.size() },
        "Dashboard client connected",
      );

      socket.on("message", (raw: Buffer) => {
        let intent: unknown;
        try {
          intent = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const type = (intent as { type?: unknown } | null)?.type;
        if (type === "refresh") hub.snapshot(socket, store.list());
      });

      socket.on("error", (error: Error) => {
        request.log.warn({ err: error }, "Dashboard socket error");
        hub.remove(socket);
      });

      socket.on("close", () => {
        hub.remove(socket);
        request.log.info({ clients: hub.size }, "Dashboard client disconnected");
      });
    },
  );
}
