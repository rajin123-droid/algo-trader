import { Router, type IRouter } from "express";
import { isAppError } from "@workspace/errors";
import { requireAuth } from "../../auth-service/src/middleware.js";
import type { OrderService } from "../services/order.service.js";
import type { ExecutionService } from "../services/execution.service.js";

/**
 * OrderController — HTTP layer for the order book.
 *
 * All business logic lives in OrderService / ExecutionService.
 * This layer only handles HTTP concerns: parsing, auth, response codes.
 *
 * Mounted at /api by the api-gateway.
 *
 * Python equivalent:
 *   @app.post('/orders')
 *   async def create_order(req):
 *     order = await order_service.create_order(req.body)
 *     return JSONResponse(order)
 */
export function createOrderController(
  orderService: OrderService,
  executionService: ExecutionService
): IRouter {
  const router = Router();

  router.post("/orders", requireAuth, async (req, res): Promise<void> => {
    const userId = String(req.userId!);

    try {
      const order = await orderService.createOrder({ ...req.body, userId });
      res.status(201).json(order);
    } catch (err) {
      if (isAppError(err)) {
        res.status(err.statusCode).json(err.toJSON());
      } else {
        res.status(500).json({ error: "Order creation failed" });
      }
    }
  });

  router.get("/orders", requireAuth, async (req, res): Promise<void> => {
    const userId = String(req.userId!);
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    try {
      const orders = await orderService.getUserOrders(userId, limit);
      res.json(orders);
    } catch (err) {
      if (isAppError(err)) {
        res.status(err.statusCode).json(err.toJSON());
      } else {
        res.status(500).json({ error: "Failed to fetch orders" });
      }
    }
  });

  router.get("/orders/:id", requireAuth, async (req, res): Promise<void> => {
    const userId = String(req.userId!);

    try {
      const order = await orderService.getOrder(req.params.id, userId);
      res.json(order);
    } catch (err) {
      if (isAppError(err)) {
        res.status(err.statusCode).json(err.toJSON());
      } else {
        res.status(500).json({ error: "Failed to fetch order" });
      }
    }
  });

  router.delete("/orders/:id", requireAuth, async (req, res): Promise<void> => {
    const userId = String(req.userId!);

    try {
      const order = await orderService.cancelOrder({ orderId: req.params.id, userId });
      res.json(order);
    } catch (err) {
      if (isAppError(err)) {
        res.status(err.statusCode).json(err.toJSON());
      } else {
        res.status(500).json({ error: "Cancel failed" });
      }
    }
  });

  router.get("/executions", requireAuth, async (req, res): Promise<void> => {
    const userId = String(req.userId!);

    try {
      const executions = await executionService.getTradesByUser(userId);
      res.json(executions);
    } catch {
      res.status(500).json({ error: "Failed to fetch executions" });
    }
  });

  return router;
}
