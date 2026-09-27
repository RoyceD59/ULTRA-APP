/**
 * Server-sent events registry for WhatsApp delivery receipt updates.
 *
 * When Baileys fires a messages.update event the handler calls
 * `pushReceiptUpdate` which fans the event out to every browser tab
 * that currently has the Notification Center open.  This eliminates the
 * need for the frontend to poll /api/notifications/logs on a timer.
 *
 * Usage (server side):
 *   import { addReceiptClient, removeReceiptClient, pushReceiptUpdate }
 *     from "./receiptStream";
 *
 * Usage (route):
 *   router.get("/notifications/receipt-stream", (req, res) => {
 *     addReceiptClient(res);
 *     req.on("close", () => removeReceiptClient(res));
 *   });
 */

import type { Response } from "express";

export interface ReceiptUpdateEvent {
  /** Baileys message key ID, matches notification_logs.whatsapp_msg_id */
  whatsappMsgId: string;
  /** Upgraded delivery status */
  deliveryStatus: "delivered" | "read";
}

// All currently connected SSE clients.
const clients = new Set<Response>();

// Heartbeat interval to keep proxies from dropping idle connections.
const HEARTBEAT_INTERVAL_MS = 25_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function ensureHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (clients.size === 0) return;
    for (const res of clients) {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        // Client disconnected between check and write — let the close handler clean up.
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  // Don't keep the process alive just for the heartbeat.
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

/**
 * Register an SSE response and set the required headers.
 * Call this from the route handler immediately after the request arrives.
 */
export function addReceiptClient(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders();

  clients.add(res);
  ensureHeartbeat();
}

/**
 * Deregister an SSE client.  Call this from the `req.on("close")` handler.
 */
export function removeReceiptClient(res: Response): void {
  clients.delete(res);
}

/**
 * Fan a receipt update out to all connected browsers.
 * Fire-and-forget — individual write errors are swallowed silently.
 */
export function pushReceiptUpdate(event: ReceiptUpdateEvent): void {
  if (clients.size === 0) return;

  const data = `data: ${JSON.stringify(event)}\n\n`;

  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      // Client disconnected between the check and the write — the close
      // handler will remove it from the set on the next tick.
    }
  }
}
