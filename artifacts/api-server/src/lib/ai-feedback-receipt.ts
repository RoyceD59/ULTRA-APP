import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function signature(payload: string): Buffer {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("Feedback signing is unavailable");
  // Separate purpose from session JWTs: a feedback receipt is never a login token.
  return createHmac("sha256", secret).update(`alison-feedback:${payload}`).digest();
}

export function issueFeedbackReceipt(
  userId: number, conversationId: string, turnId: string, question: string, answer: string,
): string {
  const payload = Buffer.from(JSON.stringify({
    userId,
    key: digest(JSON.stringify([userId, conversationId, turnId])),
    question: digest(question),
    answer: digest(answer),
    expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
  })).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifyFeedbackReceipt(
  token: unknown, userId: number, question: string, answer: string,
): string | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const expected = signature(parts[0]);
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (data.userId !== userId || !Number.isFinite(data.expires) || data.expires <= Date.now()
        || data.question !== digest(question) || data.answer !== digest(answer)
        || typeof data.key !== "string" || !/^[a-f0-9]{64}$/.test(data.key)) return null;
    return data.key;
  } catch {
    return null;
  }
}
