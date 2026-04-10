import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "http";
import { logger } from "./logger.js";
import { verifyToken } from "./jwt.js";
import {
  wsConnectionsGauge,
  wsMessageCounter,
} from "../../../../services/observability/src/index.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

interface WsClient extends WebSocket {
  /** Used by the heartbeat to detect stale connections. */
  isAlive: boolean;
  /** Set when the client authenticates via JWT query param. */
  userId?: string;
}

/* ── State ────────────────────────────────────────────────────────────────── */

/** Symbol → clients subscribed to that symbol's market data. */
const subscriptions = new Map<string, Set<WsClient>>();

/** userId → all WS connections open for that user (multiple tabs, etc.). */
const userConnections = new Map<string, Set<WsClient>>();

/** symbol → last orderbook broadcast timestamp, for 100 ms throttle. */
const lastBroadcast = new Map<string, number>();

const THROTTLE_MS = 100;

let wss: WebSocketServer | null = null;

/* ── Server bootstrap ─────────────────────────────────────────────────────── */

/**
 * Attach the WebSocket gateway to an existing Node.js HTTP server.
 *
 * Uses noServer mode so the gateway shares port 8080 with Express.
 * Upgrade path: `ws://host/ws` or `ws://host/ws?token=<JWT>`
 *
 * If a valid JWT is provided via `?token=`, the connection is added to
 * `userConnections` and will receive PORTFOLIO_UPDATE events for that user.
 *
 * Market-data subscriptions (SUBSCRIBE/UNSUBSCRIBE) work for any client,
 * authenticated or not.
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

    // Attempt JWT auth from ?token= query parameter
    const userId = extractUserId(req);
    if (userId !== null) {
      ws.userId = userId;
      if (!userConnections.has(userId)) {
        userConnections.set(userId, new Set());
      }
      userConnections.get(userId)!.add(ws);
      logger.debug({ userId, clientIp }, "WS client authenticated");
    } else {
      logger.debug({ clientIp }, "WS client connected (unauthenticated)");
    }

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
      wsConnectionsGauge.dec();
      logger.debug({ clientIp }, "WS client disconnected");
    });

    ws.on("error", (err) => {
      logger.warn({ err, clientIp }, "WS client error");
      removeClient(ws);
      wsConnectionsGauge.dec();
    });

    wsConnectionsGauge.inc();
    ws.send(JSON.stringify({ type: "CONNECTED", authenticated: userId !== null }));
  });

  startHeartbeat();
  logger.info("WebSocket gateway attached at /ws");
}

/* ── JWT extraction ───────────────────────────────────────────────────────── */

/**
 * Try to extract and verify a userId from the upgrade request.
 *
 * Checks (in order):
 *   1. `?token=<JWT>` query parameter  (browsers — can't set WS headers)
 *   2. `Authorization: Bearer <JWT>` header  (native clients, curl)
 *
 * Returns the userId string, or null if no valid token is present.
 */
function extractUserId(req: IncomingMessage): string | null {
  try {
    // 1. Query param
    const urlObj = new URL(req.url ?? "/", "http://localhost");
    const token = urlObj.searchParams.get("token");

    if (token) {
      const { userId } = verifyToken(token);
      return String(userId);
    }

    // 2. Authorization header
    const authHeader = req.headers["authorization"];
    if (authHeader?.startsWith("Bearer ")) {
      const bearerToken = authHeader.slice(7);
      const { userId } = verifyToken(bearerToken);
      return String(userId);
    }
  } catch {
    // Invalid / expired token — treat as unauthenticated
  }

  return null;
}

/* ── Message routing ──────────────────────────────────────────────────────── */

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

  ws.send(JSON.stringify({ type: "ERROR", message: `Unknown type: ${msg.type}` }));
}

function removeClient(ws: WsClient): void {
  for (const clients of subscriptions.values()) {
    clients.delete(ws);
  }

  if (ws.userId) {
    const userSet = userConnections.get(ws.userId);
    if (userSet) {
      userSet.delete(ws);
      if (userSet.size === 0) {
        userConnections.delete(ws.userId);
      }
    }
  }
}

/* ── Broadcast ────────────────────────────────────────────────────────────── */

/**
 * Fan out a payload to all clients subscribed to `symbol`.
 * Stale (CLOSING/CLOSED) connections are pruned automatically.
 *
 * @param throttle  When true, skips broadcast if last one was < 100 ms ago.
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
  let sent = 0;

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sent++;
    } else {
      clients.delete(client);
    }
  }

  if (sent > 0) wsMessageCounter.inc({ type: "market_data" });
}

/**
 * Send a payload to ALL open connections for a specific user.
 * Used for user-specific events: PORTFOLIO_UPDATE, ORDER_FILLED, etc.
 *
 * Silently no-ops if the user has no open connections.
 */
export function sendToUser(userId: string, payload: unknown): void {
  const conns = userConnections.get(userId);
  if (!conns || conns.size === 0) return;

  const message = JSON.stringify(payload);

  for (const ws of conns) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    } else {
      conns.delete(ws);
    }
  }
}

/* ── Heartbeat ────────────────────────────────────────────────────────────── */

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
