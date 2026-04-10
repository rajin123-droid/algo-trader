import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "http";
import { logger } from "@workspace/logger";

/**
 * WsGatewayServer — per-symbol subscription fan-out over WebSocket.
 *
 * Client lifecycle:
 *   1. Connect to ws://host/ws
 *   2. Send { type: "SUBSCRIBE",   symbol: "BTCUSDT" } → join the symbol group
 *   3. Send { type: "UNSUBSCRIBE", symbol: "BTCUSDT" } → leave the group
 *   4. Receive { type: "TRADE" | "ORDERBOOK", data: … } as events arrive
 *   5. Disconnect → automatically removed from all subscription groups
 *
 * The server attaches to an existing HTTP server via the "upgrade" event
 * so it shares the same port as the Express API — no second port needed.
 *
 * Broadcast throttle:
 *   Order-book snapshots are throttled to one broadcast per 100 ms per symbol
 *   to avoid overwhelming slow clients during high-frequency matching.
 *
 * Python (aiohttp) equivalent:
 *   async def ws_handler(request):
 *     ws = aiohttp.web.WebSocketResponse()
 *     await ws.prepare(request)
 *     async for msg in ws:
 *       data = json.loads(msg.data)
 *       if data["type"] == "SUBSCRIBE":
 *         clients[data["symbol"]].add(ws)
 */

interface WsClient extends WebSocket {
  isAlive: boolean;
}

const THROTTLE_MS = 100;

/** symbol → connected clients */
const subscriptions = new Map<string, Set<WsClient>>();

/** symbol → last broadcast timestamp (for throttle) */
const lastBroadcast = new Map<string, number>();

let wss: WebSocketServer | null = null;

/* ── Server creation ──────────────────────────────────────────────────── */

/**
 * Attach the WebSocket gateway to an existing Node.js HTTP server.
 * Call this once during application startup, before server.listen().
 */
export function attachWsGateway(httpServer: Server): void {
  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request: IncomingMessage, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(request, socket, head, (ws) => {
      wss!.emit("connection", ws, request);
    });
  });

  wss.on("connection", (rawWs, req) => {
    const ws = rawWs as WsClient;
    ws.isAlive = true;

    const clientIp = req.socket.remoteAddress ?? "unknown";
    logger.debug({ clientIp }, "WS client connected");

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; symbol?: string };
        handleMessage(ws, msg);
      } catch {
        ws.send(JSON.stringify({ type: "ERROR", message: "Invalid JSON" }));
      }
    });

    ws.on("close", () => {
      removeClient(ws);
      logger.debug({ clientIp }, "WS client disconnected");
    });

    ws.on("error", (err) => {
      logger.warn({ err, clientIp }, "WS client error");
      removeClient(ws);
    });

    ws.send(JSON.stringify({ type: "CONNECTED" }));
  });

  startHeartbeat();
  logger.info("WebSocket gateway attached to HTTP server at /ws");
}

/* ── Message routing ──────────────────────────────────────────────────── */

function handleMessage(ws: WsClient, msg: { type: string; symbol?: string }): void {
  const symbol = msg.symbol?.toUpperCase().replace(/[/-]/g, "");

  if (msg.type === "SUBSCRIBE" && symbol) {
    if (!subscriptions.has(symbol)) {
      subscriptions.set(symbol, new Set());
    }
    subscriptions.get(symbol)!.add(ws);
    ws.send(JSON.stringify({ type: "SUBSCRIBED", symbol }));
    logger.debug({ symbol }, "Client subscribed");
    return;
  }

  if (msg.type === "UNSUBSCRIBE" && symbol) {
    subscriptions.get(symbol)?.delete(ws);
    ws.send(JSON.stringify({ type: "UNSUBSCRIBED", symbol }));
    return;
  }

  if (msg.type === "PING") {
    ws.send(JSON.stringify({ type: "PONG" }));
    return;
  }

  ws.send(JSON.stringify({ type: "ERROR", message: `Unknown message type: ${msg.type}` }));
}

function removeClient(ws: WsClient): void {
  for (const clients of subscriptions.values()) {
    clients.delete(ws);
  }
}

/* ── Broadcast ────────────────────────────────────────────────────────── */

/**
 * Broadcast a payload to all clients subscribed to `symbol`.
 * Dead (CLOSING/CLOSED) connections are pruned automatically.
 *
 * @param symbol   Normalised symbol (e.g. "BTCUSDT")
 * @param payload  Object to JSON-serialise and send
 * @param throttle If true, skip if same symbol was broadcast < THROTTLE_MS ago
 */
export function broadcast(symbol: string, payload: unknown, throttle = false): void {
  const normalized = symbol.toUpperCase().replace(/[/-]/g, "");

  if (throttle) {
    const last = lastBroadcast.get(normalized) ?? 0;
    if (Date.now() - last < THROTTLE_MS) return;
    lastBroadcast.set(normalized, Date.now());
  }

  const clients = subscriptions.get(normalized);
  if (!clients || clients.size === 0) return;

  const message = JSON.stringify(payload);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    } else {
      clients.delete(client);
    }
  }
}

/* ── Heartbeat ────────────────────────────────────────────────────────── */

/**
 * Ping all connected clients every 30 s.
 * Clients that don't respond with a pong within the next cycle are terminated.
 */
function startHeartbeat(): void {
  const interval = setInterval(() => {
    if (!wss) return clearInterval(interval);

    for (const ws of wss.clients as Set<WsClient>) {
      if (!ws.isAlive) {
        ws.terminate();
        removeClient(ws);
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
}
