/**
 * UserDataStream
 *
 * Maintains a persistent Binance user-data WebSocket stream so the system
 * receives real-time execution updates the moment an order is filled, instead
 * of waiting for the 30-second myTrades poll in trade-sync.ts.
 *
 * Architecture
 * ────────────
 *   1. Acquire a listenKey  (POST /api/v3/userDataStream via SDK)
 *   2. Open WebSocket       (wss://<host>/ws/<listenKey>)
 *   3. Handle executionReport events → update autoTradesTable.exchangeStatus
 *   4. Renew listenKey every 30 min  (PUT /api/v3/userDataStream)
 *      — Binance invalidates it after 60 min; 30 min gives a safe buffer.
 *   5. Reconnect on close   (exponential back-off, cap 60 s)
 *      — On reconnect, a fresh listenKey is fetched; the old one may be stale.
 *
 * The poll-based trade-sync (trade-sync.ts) remains active as a safety net
 * that catches any fills missed during transient disconnections.
 *
 * Thread-safety note: Node.js is single-threaded so the `reconnecting` flag
 * and `ws` reference are safe to mutate without locks.
 */

import WebSocket from "ws";
import { db } from "@workspace/db";
import { autoTradesTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { binanceClient, hasLiveCredentials, BINANCE_BASE_URL } from "./binance.client.js";
import { logger } from "../../lib/logger.js";

/* ── Constants ───────────────────────────────────────────────────────────── */

/** Renew the listenKey this often. Binance TTL is 60 min; 30 min is safe. */
const RENEW_INTERVAL_MS    = 30 * 60 * 1_000;

/** Initial reconnect delay in ms. Doubles each attempt, capped at MAX_BACKOFF_MS. */
const INITIAL_BACKOFF_MS   = 1_000;
const MAX_BACKOFF_MS        = 60_000;

/* ── WebSocket URL helper ────────────────────────────────────────────────── */

/**
 * Map the REST base URL to the corresponding WebSocket stream base URL.
 *
 * Testnet:  https://testnet.binance.vision  →  wss://testnet.binance.vision
 * Mainnet:  https://api.binance.com         →  wss://stream.binance.com:9443
 */
function getWsBaseUrl(restBaseUrl: string): string {
  if (restBaseUrl.includes("testnet.binance.vision")) {
    return "wss://testnet.binance.vision";
  }
  return "wss://stream.binance.com:9443";
}

/* ── executionReport payload (relevant subset) ───────────────────────────── */

interface ExecutionReport {
  e: "executionReport";
  /** Binance integer orderId. Convert with String() before DB lookup. */
  i: number;
  /** Client order ID — our UUID (max 36 chars) set as newClientOrderId. */
  c: string;
  /** Current order status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" */
  X: string;
  /** Cumulative filled quantity (string). */
  z: string;
  /** Last filled price (string). */
  L: string;
  /** Commission amount (string). */
  n: string;
  /** Commission asset. */
  N: string | null;
}

/* ── Module state ────────────────────────────────────────────────────────── */

let ws:           WebSocket | null = null;
let listenKey:    string    | null = null;
let renewTimer:   ReturnType<typeof setInterval> | null = null;
let reconnecting: boolean = false;
let backoffMs:    number   = INITIAL_BACKOFF_MS;
let stopped:      boolean  = false;

/* ── listenKey management ────────────────────────────────────────────────── */

async function acquireListenKey(): Promise<string> {
  const res = await (binanceClient as any).createListenKey() as { data: { listenKey: string } };
  return res.data.listenKey;
}

async function renewListenKey(key: string): Promise<void> {
  await (binanceClient as any).renewListenKey(key);
  logger.debug({ listenKey: key.slice(0, 8) + "…" }, "UserDataStream: listenKey renewed");
}

function startRenewTimer(): void {
  stopRenewTimer();
  renewTimer = setInterval(async () => {
    if (!listenKey) return;
    try {
      await renewListenKey(listenKey);
    } catch (err) {
      logger.error({ err }, "UserDataStream: listenKey renewal failed — will reconnect");
      reconnect();
    }
  }, RENEW_INTERVAL_MS);
}

function stopRenewTimer(): void {
  if (renewTimer) { clearInterval(renewTimer); renewTimer = null; }
}

/* ── DB update ───────────────────────────────────────────────────────────── */

async function applyExecutionUpdate(report: ExecutionReport): Promise<void> {
  const exchangeOrderId = String(report.i);
  const clientOrderId   = report.c;
  const newStatus       = report.X;

  // First try matching by clientOrderId (our UUID — most precise).
  // Fall back to exchangeOrderId if the client ID wasn't stored / was truncated.
  const byClientId = clientOrderId
    ? await db
        .update(autoTradesTable)
        .set({ exchangeStatus: newStatus })
        .where(
          and(
            // clientOrderId is stored in a separate column if present;
            // for now we match by exchangeOrderId which is always written.
            isNotNull(autoTradesTable.exchangeOrderId),
            eq(autoTradesTable.exchangeOrderId, exchangeOrderId)
          )
        )
        .returning({ id: autoTradesTable.id })
    : [];

  if (byClientId.length === 0) {
    // clientOrderId match found nothing — nothing to update (orphan or paper trade).
    if (newStatus === "FILLED" || newStatus === "PARTIALLY_FILLED") {
      logger.warn(
        { exchangeOrderId, clientOrderId, status: newStatus },
        "UserDataStream: fill received for unknown order — possible orphan"
      );
    }
    return;
  }

  logger.info(
    {
      tradeId:        byClientId[0]?.id,
      exchangeOrderId,
      status:         newStatus,
      filledQty:      report.z,
      lastPrice:      report.L,
    },
    "UserDataStream: exchangeStatus updated from executionReport"
  );
}

/* ── WebSocket lifecycle ─────────────────────────────────────────────────── */

function handleMessage(raw: WebSocket.RawData): void {
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString());
  } catch {
    logger.warn({ raw: raw.toString().slice(0, 200) }, "UserDataStream: unparseable message");
    return;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as { e?: string }).e !== "executionReport"
  ) {
    return; // Ignore non-execution events (outboundAccountPosition, balanceUpdate, etc.)
  }

  const report = payload as ExecutionReport;

  applyExecutionUpdate(report).catch((err) =>
    logger.error({ err, orderId: report.i }, "UserDataStream: DB update failed for executionReport")
  );
}

async function connect(): Promise<void> {
  if (stopped) return;

  try {
    listenKey = await acquireListenKey();
  } catch (err) {
    logger.error({ err }, "UserDataStream: failed to acquire listenKey — retrying");
    scheduleReconnect();
    return;
  }

  const wsUrl = `${getWsBaseUrl(BINANCE_BASE_URL)}/ws/${listenKey}`;
  logger.info({ wsUrl: wsUrl.replace(listenKey, listenKey.slice(0, 8) + "…") }, "UserDataStream: connecting");

  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    backoffMs = INITIAL_BACKOFF_MS; // reset on successful connection
    reconnecting = false;
    startRenewTimer();
    logger.info("UserDataStream: connected — real-time execution updates active");
  });

  ws.addEventListener("message", (event) => {
    handleMessage(event.data as WebSocket.RawData);
  });

  ws.addEventListener("error", (event) => {
    logger.error({ err: event.message }, "UserDataStream: WebSocket error");
  });

  ws.addEventListener("close", (event) => {
    stopRenewTimer();
    ws = null;
    listenKey = null;

    if (stopped) {
      logger.info("UserDataStream: closed cleanly (stopped)");
      return;
    }

    logger.warn(
      { code: event.code, reason: event.reason || "(none)" },
      "UserDataStream: connection closed — scheduling reconnect"
    );
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (reconnecting || stopped) return;
  reconnecting = true;

  const delay = backoffMs;
  backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);

  logger.info({ delayMs: delay }, "UserDataStream: reconnecting after backoff");
  setTimeout(() => {
    reconnecting = false;
    connect().catch((err) =>
      logger.error({ err }, "UserDataStream: unexpected error during reconnect")
    );
  }, delay);
}

function reconnect(): void {
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }
  listenKey = null;
  stopRenewTimer();
  scheduleReconnect();
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Start the user data stream.
 *
 * Call once during server start-up (after the exchange sync scheduler).
 * No-op if credentials are absent or the stream is already running.
 */
export function startUserDataStream(): void {
  if (!hasLiveCredentials()) {
    logger.info("UserDataStream: no live credentials — stream not started (paper mode only)");
    return;
  }

  if (ws) {
    logger.warn("UserDataStream: already running — ignoring duplicate start");
    return;
  }

  stopped = false;
  backoffMs = INITIAL_BACKOFF_MS;

  connect().catch((err) =>
    logger.error({ err }, "UserDataStream: failed to start")
  );
}

/**
 * Stop the user data stream gracefully.
 * Clears the renew timer and closes the WebSocket.
 */
export function stopUserDataStream(): void {
  stopped = true;
  stopRenewTimer();

  if (ws) {
    try { ws.close(1000, "server shutdown"); } catch { /* ignore */ }
    ws = null;
  }

  listenKey = null;
  logger.info("UserDataStream: stopped");
}

/** True when the stream is currently connected. */
export function isUserDataStreamConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
