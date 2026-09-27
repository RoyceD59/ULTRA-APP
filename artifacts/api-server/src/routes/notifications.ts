import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, notificationLogsTable } from "@workspace/db";
import { dispatchToContact, type TemplateId } from "../lib/notifications";
import { addReceiptClient, removeReceiptClient } from "../lib/receiptStream";
import {
  DispatchNotificationBody,
  DispatchNotificationResponse,
  ListNotificationLogsQueryParams,
  ListNotificationLogsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * SSE endpoint — browsers subscribe here instead of polling /notifications/logs.
 * Stays open indefinitely; the server pushes a JSON event whenever Baileys
 * reports a delivery or read receipt.
 */
router.get("/notifications/receipt-stream", (req, res): void => {
  addReceiptClient(res);
  req.on("close", () => removeReceiptClient(res));
});

router.get("/notifications/logs", async (req, res): Promise<void> => {
  const query = ListNotificationLogsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;

  const logs = await db
    .select()
    .from(notificationLogsTable)
    .orderBy(desc(notificationLogsTable.sentAt))
    .limit(limit);

  res.json(ListNotificationLogsResponse.parse(logs));
});

router.post("/notifications/dispatch", async (req, res): Promise<void> => {
  const parsed = DispatchNotificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await dispatchToContact(
      parsed.data.contactId,
      parsed.data.templateId as TemplateId,
      { taskId: parsed.data.taskId },
      parsed.data.overrideChannel
    );

    res.json(DispatchNotificationResponse.parse(result));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

export default router;
