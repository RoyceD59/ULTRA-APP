import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, systemStatusTable } from "@workspace/db";
import { requireTeamAuth } from "./auth.js";
import { logger } from "../lib/logger";
import {
  CreateSystemStatusBody,
  CreateSystemStatusResponse,
  UpdateSystemStatusParams,
  UpdateSystemStatusBody,
  UpdateSystemStatusResponse,
  PingPlatformParams,
  PingPlatformResponse,
  ListSystemStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/system/status", requireTeamAuth, async (_req, res): Promise<void> => {
  const statuses = await db
    .select()
    .from(systemStatusTable)
    .orderBy(systemStatusTable.platform);
  res.json(ListSystemStatusResponse.parse(statuses));
});

router.post("/system/status", async (req, res): Promise<void> => {
  const parsed = CreateSystemStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [record] = await db
    .insert(systemStatusTable)
    .values({
      platform: parsed.data.platform,
      status: parsed.data.status ?? "connected",
      notes: parsed.data.notes ?? "",
    })
    .returning();

  res.status(201).json(CreateSystemStatusResponse.parse(record));
});

router.patch("/system/status/:id", requireTeamAuth, async (req, res): Promise<void> => {
  const params = UpdateSystemStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateSystemStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [record] = await db
    .update(systemStatusTable)
    .set({ ...parsed.data, lastChecked: new Date() })
    .where(eq(systemStatusTable.id, params.data.id))
    .returning();

  if (!record) {
    res.status(404).json({ error: "System status record not found" });
    return;
  }

  res.json(UpdateSystemStatusResponse.parse(record));
});

// Manual watchdog ping — updates lastChecked timestamp and evaluates connectivity
router.post("/system/ping/:id", async (req, res): Promise<void> => {
  const params = PingPlatformParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(systemStatusTable)
    .where(eq(systemStatusTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "System status record not found" });
    return;
  }

  // Simulate watchdog heartbeat — set lastChecked and mark as connected
  const [record] = await db
    .update(systemStatusTable)
    .set({
      lastChecked: new Date(),
      lastSync: new Date(),
      status: "connected",
    })
    .where(eq(systemStatusTable.id, params.data.id))
    .returning();

  logger.info({ platform: record?.platform }, "Watchdog ping completed");

  res.json(PingPlatformResponse.parse(record));
});

export default router;
