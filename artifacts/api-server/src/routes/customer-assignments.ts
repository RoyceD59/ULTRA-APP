import { Router } from "express";
import { pool } from "@workspace/db";
import {
  CreateCustomerAssignmentBody, ConfirmCustomerAssignmentLinkBody,
  ListCustomerAssignmentsQueryParams, ListCustomerAccountAssignmentsQueryParams,
  ListCustomerAssignmentAuditQueryParams,
} from "@workspace/api-zod";
import { requireTeamAdmin } from "./auth.js";
import { verifyToken } from "../lib/jwt.js";
import {
  AssignmentError, createAssignment, previewAssignment, linkAssignment, listAssignments,
  assignmentOrderLines, reconcileAssignmentsForAccount, assignmentAudit, listAssignmentPage, getAssignment,
} from "../lib/customer-assignments.js";

const router = Router();
type StaffRequest = import("express").Request & { teamUser?: { id: string } };
const base = "/admin/customer-assignments";
function assignmentId(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647)
    throw new AssignmentError("INVALID_ID", "Select a valid assignment.", 400);
  return Number(value);
}
// Orval's number coercion does not enforce OpenAPI integer semantics.
function validQuery(query: import("express").Request["query"], params?: { page?: number; limit?: number }) {
  return Object.values(query).every(value => typeof value === "string")
    && Number.isSafeInteger(params?.page ?? 1) && Number.isSafeInteger(params?.limit ?? 25);
}
router.use(base, requireTeamAdmin);
router.get(base, async (req, res) => {
  const parsed = ListCustomerAssignmentsQueryParams.safeParse(req.query);
  if (!parsed.success || !validQuery(req.query, parsed.data)) { res.status(400).json({ error: "Invalid assignment filters or pagination." }); return; }
  const params = { ...parsed.data, q: parsed.data.q?.trim(), page: parsed.data.page ?? 1, limit: parsed.data.limit ?? 25 };
  res.json(await listAssignmentPage(params));
});
router.get(`${base}/customer/:accountId`, async (req, res) => {
  const parsed = ListCustomerAccountAssignmentsQueryParams.safeParse(req.query);
  if (!parsed.success || !validQuery(req.query, parsed.data)) { res.status(400).json({ error: "Invalid pagination." }); return; }
  const id = assignmentId(String(req.params["accountId"]));
  const params = { page: parsed.data.page ?? 1, limit: parsed.data.limit ?? 25 };
  res.json(await listAssignmentPage(params, id));
});
router.get(`${base}/:id/audit`, async (req, res) => {
  const parsed = ListCustomerAssignmentAuditQueryParams.safeParse(req.query);
  if (!parsed.success || !validQuery(req.query, parsed.data)) { res.status(400).json({ error: "Invalid pagination." }); return; }
  res.json(await assignmentAudit(assignmentId(String(req.params["id"])), parsed.data.page ?? 1, parsed.data.limit ?? 25));
});
router.get(`${base}/order-lines`, async (req, res) => {
  res.json(await assignmentOrderLines(String(req.query["q"] ?? "")));
});
router.post(`${base}/preview`, async (req, res) => {
  const parsed = CreateCustomerAssignmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Complete the assignment fields.", code: "INVALID_INPUT" }); return; }
  const preview = await previewAssignment(parsed.data);
  res.json({ productName: preview.productName, lifespanDays: preview.lifespanDays,
    capacityLitres: preview.capacityLitres, cashCollectionState: preview.cashCollectionState });
});
router.post(base, async (req, res) => {
  const parsed = CreateCustomerAssignmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Complete the assignment fields.", code: "INVALID_INPUT" }); return; }
  res.json({ id: await createAssignment(parsed.data, (req as StaffRequest).teamUser!.id) });
});
router.post(`${base}/:id/link`, async (req, res) => {
  const parsed = ConfirmCustomerAssignmentLinkBody.safeParse(req.body);
  if (!parsed.success || parsed.data.confirm !== true || !Number.isInteger(parsed.data.accountId) || parsed.data.accountId <= 0) {
    res.status(400).json({ code: "CONFIRMATION_REQUIRED", error: "Select an account and explicitly confirm staff ownership." }); return;
  }
  const id = assignmentId(String(req.params["id"]));
  await linkAssignment(id, parsed.data.accountId, (req as StaffRequest).teamUser!.id, true);
  res.json(await getAssignment(id));
});
router.post(`${base}/:id/retry`, async (req, res) => {
  const id = assignmentId(String(req.params["id"]));
  await linkAssignment(id, undefined, (req as StaffRequest).teamUser!.id);
  res.json(await getAssignment(id));
});
router.get("/uc/customer/assignments", async (req, res) => {
  const claims = verifyToken(req.headers.authorization), id = Number(claims?.id);
  if (!claims || claims.type === "team-session" || claims.type === "team-invite" || !Number.isInteger(id) || id <= 0) { res.status(401).json({ error: "Sign in required." }); return; }
  const account = (await pool.query<{ credential_version: number; deleted_at: Date | null }>(
    "SELECT credential_version,deleted_at FROM uc_users WHERE id=$1", [id])).rows[0];
  if (!account || account.deleted_at || account.credential_version !== (claims.credentialVersion ?? 0)) {
    res.status(401).json({ error: "An active account session is required." }); return;
  }
  await reconcileAssignmentsForAccount(id);
  res.json(await listAssignments(id));
});
router.use((error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (error instanceof AssignmentError) { res.status(error.status).json({ code: error.code, error: error.message }); return; }
  next(error);
});
export default router;