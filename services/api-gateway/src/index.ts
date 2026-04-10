/**
 * API Gateway — single entry point for all REST + WS traffic.
 *
 * Architecture:
 *   Frontend → API Gateway → Services (auth, trading, portfolio, analytics, market-data, notifications)
 *                          → Event Bus (Redis Streams) → Services subscribe
 *
 * In this monolith-first approach all services are imported and their routers
 * are mounted here. This keeps a single PORT binding while preserving full
 * separation of concerns in the codebase. Services can be split into
 * independent processes later by replacing these imports with HTTP proxies.
 */

import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "@workspace/logger";
import { getEnv } from "@workspace/config";
import { startConsuming } from "@workspace/event-bus";

import { authRouter } from "../../auth-service/src/auth.router.js";
import { keysRouter } from "../../auth-service/src/keys.router.js";
import { positionsRouter } from "../../portfolio-service/src/positions.router.js";
import { analyticsRouter } from "../../analytics-service/src/analytics.router.js";
import { marketDataRouter } from "../../market-data-service/src/market-data.router.js";
import { notificationRouter } from "../../notification-service/src/notification.router.js";
import { tradesRouter, botRouter, orderRouter } from "../../trading-engine/src/index.js";
import { initEngine } from "../../trading-engine/src/engine.js";
import { startBotLoop } from "../../trading-engine/src/bot-runner.js";

const env = getEnv();
const app = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url?.split("?")[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const api = express.Router();

api.get("/healthz", (_req, res) => {
  res.json({ status: "ok", services: ["auth", "trading-engine", "portfolio", "analytics", "market-data", "notifications"] });
});

api.use(authRouter);
api.use(keysRouter);
api.use(tradesRouter);
api.use(botRouter);
api.use(orderRouter);
api.use(positionsRouter);
api.use(analyticsRouter);
api.use(marketDataRouter);
api.use(notificationRouter);

app.use("/api", api);

async function main() {
  await initEngine();

  await startConsuming(`api-gateway-${process.pid}`);

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "API Gateway listening");
    startBotLoop(60_000);
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
