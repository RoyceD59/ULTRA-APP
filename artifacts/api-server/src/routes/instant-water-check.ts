import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateAuthenticatedInstantWaterAssessmentBody,
  CreatePublicInstantWaterAssessmentBody,
  GetPublicInstantWaterAssessmentResultParams,
  RequestInstantWaterAssessmentVerificationBody,
  RequestInstantWaterAssessmentVerificationParams,
  ConfirmInstantWaterAssessmentVerificationBody,
  ConfirmInstantWaterAssessmentVerificationParams,
  AttachInstantWaterAssessmentBody,
  AttachInstantWaterAssessmentParams,
  RequestInstantWaterPhysicalTestBody,
  RequestInstantWaterPhysicalTestParams,
  ListProjectHubInstantWaterAssessmentsQueryParams,
  GetProjectHubInstantWaterAssessmentParams,
  UpdateProjectHubInstantWaterAssessmentParams,
  UpdateProjectHubInstantWaterAssessmentBody,
  ConsumeInstantWaterAssessmentHandoffBody,
} from "@workspace/api-zod";
import {
  isValidInstantFirstName,
  isValidInstantPhone,
} from "@workspace/api-zod/instant-water-identity";
import { countryCodeFromValue } from "@workspace/api-zod/phone";
import { verifyToken } from "../lib/jwt.js";
import { getLiveWaterTestsAccess } from "../lib/adminAuth.js";
import { sendSmsAwaitable } from "../lib/sms.js";
import { sendWhatsAppMessage } from "../lib/whatsapp.js";
import { logger } from "../lib/logger.js";
import {
  attachAssessment,
  confirmVerification,
  createInstantAssessment,
  getAdminAssessment,
  getOwnedAssessment,
  getPublicAssessment,
  hashInstantSecurityKey,
  latestOwnedAssessmentSummary,
  listAdminAssessments,
  listOwnedAssessments,
  requestPhysicalTest,
  requestVerification,
  updateAdminAssessment,
  recordInstantAudit,
  consumeInstantAssessmentHandoff,
} from "../lib/instant-water-check-service.js";

const router: IRouter = Router();

function bearerUserId(req: Request): string | null {
  const claims = verifyToken(req.headers.authorization);
  if (!claims) return null;
  const id = String(claims.id);
  return /^\d+$/.test(id) && Number(id) > 0 && Number(id) < 1_000_000_000 ? id : null;
}

function parsed<T>(schema: { safeParse: (input: unknown) => { success: boolean; data?: T } }, input: unknown): T | null {
  const result = schema.safeParse(input);
  return result.success ? (result.data as T) : null;
}

function onlyKeys(value: unknown, keys: readonly string[]): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key));
}

function validAnswers(value: unknown): boolean {
  return onlyKeys(value, ["country", "area", "source", "concern", "symptom", "useContext", "setting"]);
}

function identityError(value: unknown): "INVALID_FIRST_NAME" | "INVALID_PHONE" | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as { firstName?: unknown; phone?: unknown; answers?: { country?: unknown } };
  if (typeof input.firstName === "string" && !isValidInstantFirstName(input.firstName)) {
    return "INVALID_FIRST_NAME";
  }
  const country = typeof input.answers?.country === "string"
    ? countryCodeFromValue(input.answers.country)
    : "KE";
  if (typeof input.phone === "string" && !isValidInstantPhone(input.phone, country ?? "KE")) {
    return "INVALID_PHONE";
  }
  return null;
}

function fail(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "";
  const safeCodes = new Set([
    "RATE_LIMITED", "IDEMPOTENCY_CONFLICT", "CONFLICT", "OWNERSHIP_CONFLICT", "NOT_FOUND",
    "ACTION_UNAUTHORIZED", "OTP_LOCKED", "INVALID_CODE", "SMS_CONSENT_REQUIRED",
     "INVALID_FIRST_NAME", "INVALID_PHONE", "MEDIA_LIMIT", "INVALID_MEDIA_REFERENCE", "ACKNOWLEDGEMENT_REQUIRED",
    "EXPECTED_UPDATED_AT_REQUIRED", "INVALID_STATE_TRANSITION", "MEDIA_OWNERSHIP_INVALID",
    "DELIVERY_RETRYABLE", "DELIVERY_IN_PROGRESS",
    "MEDIA_METADATA_INVALID",
  ]);
  if (safeCodes.has(code)) logger.warn({ code }, "Instant water check request rejected");
  const status =
    code === "RATE_LIMITED" ? 429 :
    code === "IDEMPOTENCY_CONFLICT" || code === "CONFLICT" || code === "OWNERSHIP_CONFLICT" ? 409 :
    code === "NOT_FOUND" ? 404 :
    code === "ACTION_UNAUTHORIZED" ? 401 :
    code === "OTP_LOCKED" ? 429 :
    code === "DELIVERY_RETRYABLE" ? 503 :
    code === "DELIVERY_IN_PROGRESS" ? 409 :
    code === "HANDOFF_INVALID" ? 403 :
    code === "INVALID_CODE" ? 400 :
     code === "SMS_CONSENT_REQUIRED" || code.endsWith("_REQUIRED") || code === "INVALID_FIRST_NAME" || code === "INVALID_PHONE" || code === "MEDIA_LIMIT" || code === "INVALID_MEDIA_REFERENCE" || code === "MEDIA_OWNERSHIP_INVALID" || code === "MEDIA_METADATA_INVALID" || code === "INVALID_STATE_TRANSITION" ? 400 : 500;
  const messages: Record<string, string> = {
    INVALID_FIRST_NAME: "Please enter a valid first name",
    INVALID_PHONE: "Please enter a valid phone number for the selected country",
  };
  res.status(status).json({ error: status === 500 ? "Water assessment operation failed" : messages[code] ?? code.toLowerCase().replaceAll("_", " ") });
}

router.post("/water-check/assessments", async (req, res) => {
  const body = parsed(CreatePublicInstantWaterAssessmentBody.strict(), req.body);
  const identityCode = identityError(req.body);
  if (identityCode) {
    fail(res, new Error(identityCode));
    return;
  }
  if (!body || body.consent !== true ||
      !onlyKeys(req.body, ["firstName", "phone", "consent", "consentVersion", "idempotencyKey", "sourceAttribution", "answers"]) ||
      !validAnswers(req.body?.answers) ||
      (req.body?.sourceAttribution !== undefined && !onlyKeys(req.body.sourceAttribution, ["src", "utmSource", "utmMedium", "utmCampaign", "utmContent"]))) {
    res.status(400).json({ error: "Invalid water assessment input" });
    return;
  }
  try {
    const result = await createInstantAssessment({
      firstName: body.firstName,
       // Keep the raw value through the country-aware service normalizer;
       // the generated transport schema cannot perform this cross-field check.
       phone: typeof req.body.phone === "string" ? req.body.phone : body.phone,
      consentVersion: body.consentVersion,
      country: body.answers.country,
      area: body.answers.area,
      answers: body.answers,
      sourceAttribution: body.sourceAttribution,
       scope: `public:${hashInstantSecurityKey(req.ip ?? "unknown")}`,
       idempotencyKey: body.idempotencyKey,
       rateKey: hashInstantSecurityKey(req.ip ?? "unknown"),
    });
    res.status(result.replay ? 200 : 201).json(result.response);
  } catch (error) {
    fail(res, error);
  }
});

router.post("/uc/water-check/assessments", async (req, res) => {
  const userId = bearerUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const body = parsed(CreateAuthenticatedInstantWaterAssessmentBody.strict(), req.body);
  const identityCode = identityError(req.body);
  if (identityCode) {
    fail(res, new Error(identityCode));
    return;
  }
  if (!body || !onlyKeys(req.body, ["answers", "firstName", "phone", "idempotencyKey"]) || !validAnswers(req.body?.answers)) {
    res.status(400).json({ error: "Invalid water assessment input" });
    return;
  }
  try {
    const result = await createInstantAssessment({
      firstName: body.firstName ?? "",
       phone: typeof req.body.phone === "string" ? req.body.phone : (body.phone ?? ""),
      consentVersion: "authenticated-session",
      country: body.answers.country,
      area: body.answers.area,
      answers: body.answers,
      customerUserId: userId,
      scope: `customer:${userId}`,
      idempotencyKey: body.idempotencyKey,
      rateKey: hashInstantSecurityKey(req.ip ?? "unknown"),
    });
    res.status(result.replay ? 200 : 201).json(result.response);
  } catch (error) {
    fail(res, error);
  }
});

router.get("/water-check/results/:token", async (req, res) => {
  const params = parsed(GetPublicInstantWaterAssessmentResultParams, req.params);
  if (!params) {
    res.status(404).json({ error: "Result not found" });
    return;
  }
  try {
    const result = await getPublicAssessment(params.token, hashInstantSecurityKey(req.ip ?? "unknown"));
    if (!result) {
      res.status(404).json({ error: "Result not found" });
      return;
    }
    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    res.status(404).json({ error: "Result not found" });
  }
});

router.post("/water-check/assessments/:assessmentId/verification/request", async (req, res) => {
  const params = parsed(RequestInstantWaterAssessmentVerificationParams, req.params);
  const body = parsed(RequestInstantWaterAssessmentVerificationBody.strict(), req.body);
  if (!params || !body || !onlyKeys(req.body, ["channel", "smsConsent", "idempotencyKey"])) {
    res.status(400).json({ error: "Invalid verification input" });
    return;
  }
  try {
    const result = await requestVerification({
      assessmentId: params.assessmentId,
      channel: body.channel,
      smsConsent: body.smsConsent,
       idempotencyKey: body.idempotencyKey,
      rateKey: hashInstantSecurityKey(req.ip ?? "unknown"),
      deliver: async (channel, phone, code, assessmentId) => {
        const message = `Your Ultra Clear water check verification code is ${code}. It expires in 10 minutes.`;
        if (channel === "whatsapp") {
          await sendWhatsAppMessage(phone, message);
        } else {
          await sendSmsAwaitable(phone, message, { template: "instant_water_check_otp", testId: assessmentId });
        }
      },
    });
    res.status(202).json({ accepted: true, channel: result.channel });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/water-check/assessments/:assessmentId/verification/confirm", async (req, res) => {
  const params = parsed(ConfirmInstantWaterAssessmentVerificationParams, req.params);
  const body = parsed(ConfirmInstantWaterAssessmentVerificationBody.strict(), req.body);
  if (!params || !body || !onlyKeys(req.body, ["code"])) {
    res.status(400).json({ error: "Invalid verification code" });
    return;
  }
  try {
    res.json({ verified: true, ...(await confirmVerification(
      params.assessmentId,
      body.code,
      hashInstantSecurityKey(req.ip ?? "unknown"),
    )) });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/water-check/handoff/consume", async (req, res) => {
  const userId = bearerUserId(req);
  const body = parsed(ConsumeInstantWaterAssessmentHandoffBody.strict(), req.body);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!body || !onlyKeys(req.body, ["handoffToken"])) {
    res.status(400).json({ error: "Invalid handoff token" });
    return;
  }
  try {
    res.json(await consumeInstantAssessmentHandoff(body.handoffToken, userId));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/uc/water-check/assessments/:assessmentId/attach", async (req, res) => {
  const userId = bearerUserId(req);
  const params = parsed(AttachInstantWaterAssessmentParams, req.params);
  const body = parsed(AttachInstantWaterAssessmentBody.strict(), req.body);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!params || !body || !onlyKeys(req.body, ["actionToken", "resultToken"])) {
    res.status(400).json({ error: "Invalid attachment input" });
    return;
  }
  try {
    await attachAssessment(params.assessmentId, body.actionToken, body.resultToken, userId);
    const assessment = await getOwnedAssessment(params.assessmentId, userId);
    if (!assessment) {
      res.status(404).json({ error: "Assessment not found" });
      return;
    }
    res.json(assessment);
  } catch (error) {
    fail(res, error);
  }
});

router.post("/uc/water-check/assessments/:assessmentId/physical-test", async (req, res) => {
  const params = parsed(RequestInstantWaterPhysicalTestParams, req.params);
  const body = parsed(RequestInstantWaterPhysicalTestBody.strict(), req.body);
  if (!params || !body ||
      !onlyKeys(req.body, ["actionToken", "idempotencyKey", "serviceAddress", "preferredContactTime", "acknowledgement", "mediaReferences"]) ||
      (req.body?.mediaReferences !== undefined &&
       (!Array.isArray(req.body.mediaReferences) ||
        req.body.mediaReferences.some((item: unknown) => !onlyKeys(item, ["reference", "mediaType"]))))) {
    res.status(400).json({ error: "Invalid physical test request" });
    return;
  }
  try {
    const result = await requestPhysicalTest({
      assessmentId: params.assessmentId,
      actionToken: body.actionToken,
      userId: bearerUserId(req) ?? undefined,
      serviceAddress: body.serviceAddress,
      preferredContactTime: body.preferredContactTime,
      acknowledgement: body.acknowledgement,
      mediaReferences: body.mediaReferences,
       idempotencyKey: body.idempotencyKey,
    });
    res.json(result);
  } catch (error) {
    fail(res, error);
  }
});

router.get("/uc/me/water-check/assessments", async (req, res) => {
  const userId = bearerUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    res.json({ assessments: await listOwnedAssessments(userId) });
  } catch {
    res.status(500).json({ error: "Could not load water assessment history" });
  }
});

router.get("/uc/me/water-check/latest", async (req, res) => {
  const userId = bearerUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    res.json({ assessment: await latestOwnedAssessmentSummary(userId) });
  } catch {
    res.status(500).json({ error: "Could not load latest water assessment" });
  }
});

router.get("/uc/admin/water-checks", async (req, res) => {
  const access = await getLiveWaterTestsAccess(req.headers.authorization);
  if (!access) {
    res.status(403).json({ error: "water_tests permission required" });
    return;
  }
  const query = parsed(ListProjectHubInstantWaterAssessmentsQueryParams, req.query);
  if (!query || (query.customerId !== undefined && !Number.isInteger(query.customerId))) {
    res.status(400).json({ error: "Invalid queue parameters" });
    return;
  }
  try {
    res.json(await listAdminAssessments(query.page, query.limit, query.status, query.customerId));
  } catch {
    res.status(500).json({ error: "Could not load water assessment queue" });
  }
});

router.get("/uc/admin/water-checks/:assessmentId", async (req, res) => {
  const access = await getLiveWaterTestsAccess(req.headers.authorization);
  if (!access) {
    res.status(403).json({ error: "water_tests permission required" });
    return;
  }
  const params = parsed(GetProjectHubInstantWaterAssessmentParams, req.params);
  if (!params) {
    res.status(400).json({ error: "Invalid assessment id" });
    return;
  }
  const result = await getAdminAssessment(params.assessmentId);
  if (!result) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }
  await recordInstantAudit(params.assessmentId, access.teamUserId, "detail_view", {});
  res.json(result);
});

router.patch("/uc/admin/water-checks/:assessmentId", async (req, res) => {
  const access = await getLiveWaterTestsAccess(req.headers.authorization);
  if (!access || (access.level !== "edit" && access.level !== "admin")) {
    res.status(403).json({ error: "water_tests permission required" });
    return;
  }
  const params = parsed(UpdateProjectHubInstantWaterAssessmentParams, req.params);
  const body = parsed(UpdateProjectHubInstantWaterAssessmentBody.strict(), req.body);
  if (!params || !body || !onlyKeys(req.body, ["serviceState", "expectedUpdatedAt", "internalNote"]) ||
      Number.isNaN(new Date(body.expectedUpdatedAt).getTime())) {
    res.status(400).json({ error: "Invalid assessment update" });
    return;
  }
  const current = await getAdminAssessment(params.assessmentId);
  if (!current) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }
  await recordInstantAudit(params.assessmentId, access.teamUserId, "detail_view", { context: "patch" });
  if (current.serviceState === "closed" && body.serviceState !== "closed" && access.level !== "admin") {
    res.status(403).json({ error: "Administrator access required to reopen a closed ticket" });
    return;
  }
  try {
    const result = await updateAdminAssessment(params.assessmentId, body);
    await recordInstantAudit(params.assessmentId, access.teamUserId, "status_update", {
      serviceState: body.serviceState,
      expectedUpdatedAt: body.expectedUpdatedAt,
    });
    res.json(result);
  } catch (error) {
    fail(res, error);
  }
});

export default router;