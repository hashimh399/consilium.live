import type { WebSocket } from "ws";

import type { ActiveCall, DashboardMessage } from "../types.js";

const HEARTBEAT_MS = 30_000;

/**
 * Registry of connected dashboard sockets.
 *
 * A heartbeat drops sockets that stop answering pings, which otherwise
 * accumulate whenever a browser tab is closed without a clean handshake.
 */
export class DashboardHub {
  private readonly clients = new Set<WebSocket>();
  private readonly alive = new WeakSet<WebSocket>();
  private heartbeat: NodeJS.Timeout | null = null;

  get size(): number {
    return this.clients.size;
  }

  add(socket: WebSocket): void {
    this.clients.add(socket);
    this.alive.add(socket);
    socket.on("pong", () => this.alive.add(socket));
    this.startHeartbeat();
  }

  remove(socket: WebSocket): void {
    this.clients.delete(socket);
    if (this.clients.size === 0) this.stopHeartbeat();
  }

  send(socket: WebSocket, message: DashboardMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  snapshot(socket: WebSocket, calls: ActiveCall[]): void {
    this.send(socket, {
      type: "snapshot",
      calls,
      at: new Date().toISOString(),
    });
  }

  broadcastCall(call: ActiveCall): void {
    this.broadcast({
      type: "call.update",
      call,
      at: new Date().toISOString(),
    });
  }

  broadcast(message: DashboardMessage): void {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify(message);
    for (const socket of this.clients) {
      if (socket.readyState !== socket.OPEN) continue;
      socket.send(payload);
    }
  }

  closeAll(): void {
    this.stopHeartbeat();
    for (const socket of this.clients) socket.close(1001, "server shutting down");
    this.clients.clear();
  }

  private startHeartbeat(): void {
    if (this.heartbeat !== null) return;
    this.heartbeat = setInterval(() => {
      for (const socket of this.clients) {
        if (!this.alive.has(socket)) {
          socket.terminate();
          this.clients.delete(socket);
          continue;
        }
        this.alive.delete(socket);
        socket.ping();
      }
      if (this.clients.size === 0) this.stopHeartbeat();
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
