import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { and, desc, gte, lt } from "drizzle-orm";
import { db, ucEnquiriesTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

/** Parse a real calendar date; Date alone would normalize invalid days. */
function utcDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date : null;
}

const router = Router();

router.get("/uc/enquiries", async (req, res): Promise<void> => {
  // Contact details must not remain in a browser or intermediary cache.
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !secret.trim()) {
    res.status(503).json({ error: "Enquiry admin access is not configured" });
    return;
  }
  const supplied = req.get("X-Admin-Key");
  // Hash to equal-length buffers before the constant-time comparison.
  if (!supplied || !timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256").update(secret).digest(),
  )) {
    res.status(401).json({ error: "Missing or invalid X-Admin-Key" });
    return;
  }

  const from = req.query.from === undefined ? undefined : utcDay(req.query.from);
  const to = req.query.to === undefined ? undefined : utcDay(req.query.to);
  if (from === null || to === null || (from && to && from > to)) {
    res.status(400).json({ error: "Use valid YYYY-MM-DD dates with from on or before to" });
    return;
  }
  const until = to ? new Date(to.getTime() + 86_400_000) : undefined;
  try {
    const enquiries = await db.select({
      id: ucEnquiriesTable.id,
      productId: ucEnquiriesTable.productId,
      productName: ucEnquiriesTable.productName,
      name: ucEnquiriesTable.name,
      email: ucEnquiriesTable.email,
      phone: ucEnquiriesTable.phone,
      message: ucEnquiriesTable.message,
      createdAt: ucEnquiriesTable.createdAt,
    }).from(ucEnquiriesTable).where(and(
      from ? gte(ucEnquiriesTable.createdAt, from) : undefined,
      until ? lt(ucEnquiriesTable.createdAt, until) : undefined,
    )).orderBy(desc(ucEnquiriesTable.createdAt), desc(ucEnquiriesTable.id));
    res.json(enquiries);
  } catch {
    // Never disguise a failed query as an empty list or log customer details.
    logger.error("Failed to list customer enquiries");
    res.status(503).json({ error: "Enquiries are temporarily unavailable" });
  }
});

export default router;