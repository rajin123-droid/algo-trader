/**
 * Notification Service
 *
 * Responsibilities:
 *   - In-app alerts (trade fills, bot signals, system messages)
 *   - Email notifications (future: Resend / SendGrid)
 *   - Subscribes to ORDER_FILLED, BOT_SIGNAL, ALERT_TRIGGERED events
 *
 * Currently a stub — ready for integration.
 */

export { notificationRouter } from "./notification.router.js";
