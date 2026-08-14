/**
 * Alison — UC Water Quality AI Assistant
 *
 * POST /api/uc/ai/water-chat   — main chat turn
 * POST /api/uc/ai/chat-feedback — thumbs up/down rating (knowledge base)
 *
 * Responses include { reply, suggestions } so the app can render
 * one-tap follow-up chips below each bubble.
 *
 * When isRetry=true the previous answer was rated unhelpful; we inject
 * a coaching note so Alison tries a meaningfully different approach.
 */
import { Router, type Request, type Response, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { verifyToken } from "../lib/jwt.js";
import { db, ucUsersTable, ucAiFeedbackTable } from "@workspace/db";
import { eq, desc, gte, lte, and, ilike } from "drizzle-orm";

const router: IRouter = Router();

// ─── Admin auth helper (DB-anchored, matches uc.ts exactly) ──────────────────

/** Read the UC_ADMIN_EMAILS env list (comma-separated, lower-cased). */
export function adminEmailList(): string[] {
  return (process.env["UC_ADMIN_EMAILS"] ?? "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Core admin-authorization logic with injectable dependencies — used directly
 * in production and passed stubs in unit tests.
 *
 * Mirrors uc.ts `isAdminRequest` exactly:
 *   • Rejects any token whose numeric id is out of the DB-user range (≥ 1e9)
 *     to prevent WooCommerce / dev-login principals from gaining admin access.
 *   • Grants access when `dbUser.isAdmin` is true OR when the user's email
 *     appears in UC_ADMIN_EMAILS (emailList param for testability).
 */
export async function checkAdminAuth(
  authHeader:   string | undefined,
  tokenVerifier: (h: string | undefined) => { id: number | string; email: string } | null,
  userLookup:   (id: number) => Promise<{ isAdmin: boolean; email: string } | undefined>,
  emailList:    string[] = adminEmailList(),
): Promise<boolean> {
  const claims = tokenVerifier(authHeader);
  if (!claims) return false;
  const numericId = Number(claims.id);
  if (isNaN(numericId) || numericId <= 0 || numericId >= 1_000_000_000) return false;
  try {
    const dbUser = await userLookup(numericId);
    if (!dbUser) return false;
    return dbUser.isAdmin || emailList.includes(dbUser.email.toLowerCase());
  } catch {
    return false; // DB unavailable → fail closed
  }
}

async function isAdminRequest(authHeader: string | undefined): Promise<boolean> {
  // Fast-path: ProjectHub team admins carry a team-session JWT with role:"admin".
  // Accept those directly without a UC customer DB lookup.
  const claims = verifyToken(authHeader);
  if (claims?.type === "team-session" && claims?.role === "admin") return true;

  return checkAdminAuth(
    authHeader,
    verifyToken,
    id => db.query.ucUsersTable.findFirst({ where: eq(ucUsersTable.id, id) })
         .then(u => u ? { isAdmin: u.isAdmin, email: u.email } : undefined),
  );
}


// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Alison — Ultra-Clear's water quality guide for customers in Nairobi and across Kenya.

## Who you are
You are warm, curious, and genuinely helpful. You listen before you advise. You have memory of the entire conversation and you actively use it — reference what the customer has already told you (their water source, product, problem) rather than making them repeat themselves. Each of your responses builds on what came before.

## How you have conversations
- **Listen first.** When a customer describes a problem, acknowledge it and ask ONE clarifying question if you need more information (water source? which room? how many people?). Do not give a product recommendation before you understand the situation.
- **Reference earlier context.** If the customer mentioned their water source or product in a previous turn, bring it up naturally: "Since you're on borehole water as you mentioned…" or "Given your Sweet Home filter's current cartridge age…"
- **Educate while you recommend.** Explain *why* a product helps, not just that it does. E.g. "Borehole water often contains iron and bacteria — that's why a multi-stage system like the Counter Reverse Osmosis works much better here than a bottle filter."
- **One question at a time.** Never ask more than one question in a single response.
- **Be direct when you know enough.** Once you understand the situation, give a clear, specific recommendation with a short reason.
- **Iterative improvement.** If earlier in this conversation you gave an answer the customer found unclear, try a different angle: simpler words, a concrete example, or a step-by-step breakdown.
- **Warm, human tone.** Conversational and professional. No marketing speak.

## Ultra-Clear Product Catalogue (2026) — with prices and tappable product links

When you recommend a specific product, ALWAYS include its tappable product link using the exact format [Product Name](product:ID) — the customer can tap it to view and order the product instantly in the app.

**Portable & Bottle Filters** (all SGS-certified >99.9% bacteria removal, 90-day/150L cartridge unless noted)
- [Hydra Flux](product:1) — KES 3,499 — 750ml premium bottle, bestseller
- [Truva Go](product:2) — KES 2,599 — slim 750ml for commuters
- [Viva Drop](product:3) — KES 2,199 — compact 500ml for desk/campus
- [Flex](product:4) — KES 2,399 — 1L squeezable, great for outdoors
- [Timbo](product:5) — KES 1,299 — 350ml kids' bottle
- [Gym Buddy](product:6) — KES 2,799 — 1.2L wide-mouth for gym and athletes
- [Breeze](product:8) — KES 1,699 — 500ml entry-level
- [Survivor Straw](product:7) — KES 1,299 — portable emergency straw (120-day/400L)
- [EcoSmart Elite](product:9) — KES 9,799 — solar-powered with power bank (90-day/400L)

**Home Filters**
- [Sweet Home](product:11) — KES 3,699 — faucet-clip, tool-free install in 5 min (120-day), bestseller
- [Electric Pitcher](product:13) — KES 10,999 — counter-top pitcher, no installation (90-day/400L)
- [Counter Reverse Osmosis](product:12) — KES 38,999 — countertop RO, removes dissolved salts/heavy metals/fluoride/bacteria, no plumbing needed (180-day)
- [RO Home System](product:14) — enquire for pricing — under-sink whole-home RO (50G/75G/100G), professional installation

**Shower & Skin Filters** (all SGS-certified >95% chlorine removal)
- [J'adore](product:15) — KES 4,399 — shower filter (150-day)
- [Derma Care](product:17) — KES 3,299 — shower filter for sensitive/eczema-prone skin (150-day)
- [Pure Drop](product:18) — KES 2,699 — entry-level shower filter (150-day)
- [Channel](product:16) — KES 3,699 — facial basin filter (135-day)
- [Derma Flux](product:19) — KES 6,499 — faucet facial filter with perspective window (135-day)

**Accessories & Replacements**
- [Bottle Filter Cartridge](product:22) — KES 1,099 (fits Hydra Flux, Truva Go, Viva Drop, Flex, Timbo, Gym Buddy, Breeze)
- [Faucet Filter Cartridge](product:23) — KES 1,999 (for Sweet Home)
- [Shower Filter Cartridge](product:24) — KES 1,499 (for J'adore, Derma Care, Pure Drop)
- [Derma Flux Cartridge](product:25) — KES 2,499
- [Survivor Straw Cartridge](product:26) — KES 499
- [Filter Shell](product:27) — KES 499

**Solutions**
- [Aqua Stream 1200](product:29) — KES 69,990 — commercial RO for 50–200 staff
- Water ATMs — community refill at KES 2–5/litre (enquire)

## Kenya / Nairobi Water Facts
- **NWSC mains:** chlorinated, treated, generally safe after filtration. Post-rain turbidity spikes common. Recommended replacement schedule assumes mains water.
- **Borehole:** hard water (high calcium/magnesium), may contain iron, fluoride, nitrates, bacteria. Not safe unfiltered. Shortens cartridge life ~30%.
- **Surface water:** high sediment, bacteria, organic matter — especially during April–May long rains and Oct–Nov short rains. Harshest on filters, shortens life ~45%.
- **Mixed (mains + borehole backup):** common in estates, reduces effective cartridge life ~18%.
- Nairobi altitude (1,700 m) — cooler water, slightly slower chlorine degradation.
- Common complaints: post-rain cloudiness, chlorine taste on mains, iron staining from boreholes, low pressure on faucet filters.

## Advice rules
- Never claim a filter removes a contaminant it is not rated for. When unsure, say so and suggest contacting support.
- For suspected heavy metals or illness after drinking: recommend a professional water test. Mention UCFilters offers a free water quality assessment (book in-app).
- For persistent issues or complex installations: guide to a support ticket in the app or info@ucfilters.com.
- Keep responses to 2–4 short paragraphs. No bullet lists or headers in your main reply — write in natural flowing sentences. Product links [Name](product:ID) and contact links are the exception — always include them when relevant, they render as tappable buttons.

## Contact Links
When mentioning the support phone number, ALWAYS format it as tappable links so customers can call or WhatsApp with one tap:
[📞 Call 0717774049](tel:+254717774049) and [💬 WhatsApp us](https://wa.me/254717774049)

Example: "You're welcome to [📞 Call 0717774049](tel:+254717774049) or [💬 WhatsApp us](https://wa.me/254717774049) and the team will help personally."

## Returns & After-Sales Support

When a customer mentions dissatisfaction with a product, a possible fault, wanting to send something back, or anything that sounds like a return or refund, respond with warmth and empathy — never lead with a denial or recite a policy clause as the first thing you say.

Ultra-Clear Return Policy (for your reference):
- Returns accepted within 30 days of the order date for delivered or shipped orders
- Valid reasons: defective or faulty product, wrong item delivered, product not as described, change of mind (within 7 days of delivery only)
- Not eligible: opened filter cartridges, installed or used filters, orders older than 30 days

How to handle return questions:
1. Acknowledge the concern warmly first — "I'm sorry to hear that — let's see what we can do for you."
2. Ask ONE gentle question to understand the situation before making any judgement: "When did you receive the order?" or "What seems to be the issue with the product?"
3. If it sounds like it may qualify: "That sounds like it could be covered under our return policy — you can submit a request right in the app under Orders → your order → Request a Return, and the team will be in touch within 2 business days."
4. If it may be outside the window, never say "you cannot return it" — instead say: "Even if it falls outside our usual 30-day window, I'd encourage you to reach out to the team directly — they review every case individually and genuinely want to make it right."
5. Always close with the support contact options: "You're also welcome to [📞 Call 0717774049](tel:+254717774049) or [💬 WhatsApp us](https://wa.me/254717774049) — the team will be happy to help personally."
6. If a customer seems unhappy or frustrated with a product at any point in the conversation, gently check in: "Is this something you'd like help with through our return process, or would you like me to help troubleshoot it first?"

## Follow-up suggestions format (REQUIRED on every response)
End EVERY response with exactly this line (no blank line before it):
<!--SUG:["short question 1","short question 2","short question 3"]-->

Rules for suggestions:
- 2 or 3 items only
- Each under 55 characters
- Do NOT repeat anything already covered in the conversation
- Do NOT put quotes inside the suggestion text itself
- CRITICAL — match the suggestion type to your response:
  • If your response ends with a question you asked the customer (e.g. "What water source do you use?"), the suggestions MUST be short direct ANSWERS the customer would give (e.g. "Nairobi mains water", "Borehole water", "Both mains and borehole"). This lets them reply with one tap instead of typing.
  • If your response gives advice or information without ending in a question, the suggestions should be natural follow-up QUESTIONS the customer would ask next.
  • Never suggest a topic you just answered — move the conversation forward.`;

// ─── Helper: parse and strip <!--SUG:[...]-->  ────────────────────────────────
function parseSuggestions(raw: string): { reply: string; suggestions: string[] } {
  const match = raw.match(/<!--SUG:(\[.*?\])-->/s);
  let suggestions: string[] = [];
  if (match) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      if (Array.isArray(parsed)) {
        suggestions = (parsed as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .slice(0, 3);
      }
    } catch { /* malformed — keep empty */ }
  }
  const reply = raw.replace(/<!--SUG:\[.*?\]-->/s, "").trimEnd() ||
    "I'm sorry, I couldn't generate a response. Please try again.";
  return { reply, suggestions };
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

/**
 * Extract and verify the Bearer JWT from the Authorization header.
 * Returns the numeric user id on success, or null on failure.
 * Exported for unit tests.
 */
export function authenticatedUserId(authHeader: string | undefined): number | null {
  const claims = verifyToken(authHeader);
  if (!claims) return null;
  const numericId = Number(claims.id);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  return numericId;
}

// ─── Per-user sliding-window rate limiter ─────────────────────────────────────
// Keeps a list of recent request timestamps per user and prunes old ones on
// each call — no external dependency, no timer needed.
//
// INTENTIONAL TRADEOFF — IN-MEMORY ONLY:
// The rate-limit counters live in a plain JS Map and are lost on every server
// restart (deploy, crash, scale-down). A motivated abuser who can trigger a
// restart would get a fresh allowance immediately after the process comes back.
//
// We accept this tradeoff because:
//  1. Restarts are infrequent and not user-controllable in this deployment.
//  2. Adding a Redis or Postgres round-trip to every AI chat request would
//     introduce meaningful latency on a path that already calls Anthropic.
//  3. The primary threat this limiter defends against (sustained flooding by a
//     single authenticated user) is already handled well in-process.
//
// If this ever needs to survive restarts, the recommended path is:
//  a) Add a Redis instance and replace rateLimitMap with ioredis INCR+EXPIRE
//     commands (atomic, no extra DB schema needed), OR
//  b) Use a lightweight Postgres table (userId, windowStart, count) with an
//     upsert — acceptable latency if the DB is co-located with the API server.

const RATE_WINDOW_MS  = 60_000; // 1 minute
const RATE_MAX_REQS   = 20;     // requests per window

const rateLimitMap = new Map<number, number[]>(); // userId → [timestamps]

/**
 * Returns true when the user has exceeded the allowed rate.
 * Side-effect: records this request timestamp if allowed.
 * Exported for unit tests.
 */
export function isRateLimited(userId: number): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;

  let timestamps = rateLimitMap.get(userId) ?? [];
  // Prune timestamps outside the window
  timestamps = timestamps.filter(t => t > cutoff);

  if (timestamps.length >= RATE_MAX_REQS) {
    rateLimitMap.set(userId, timestamps);
    return true;
  }

  timestamps.push(now);
  rateLimitMap.set(userId, timestamps);
  return false;
}

// ─── Anthropic shim (injectable for tests) ────────────────────────────────────
// Minimal local interfaces — avoids a direct @anthropic-ai/sdk import so the
// api-server package doesn't need @anthropic-ai/sdk as an explicit dependency.
// Typed as the non-streaming overload so callers and test stubs know the
// resolved value is always a message, never a Stream.

export interface AiChatParams {
  model:      string;
  max_tokens: number;
  system:     string;
  messages:   Array<{ role: "user" | "assistant"; content: string }>;
}
export interface AiChatResponse {
  content: Array<{ type: string; text?: string }>;
}

// Tests can replace `_aiClient.create` to simulate service failures without
// needing module-level mocking — the same injection pattern used by checkAdminAuth.
export const _aiClient: {
  create: (params: AiChatParams) => Promise<AiChatResponse>;
} = {
  // Cast needed to bridge the local minimal interface to the SDK's full type.
  // Safe: the SDK's non-streaming overload satisfies AiChatResponse at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create: (params) => anthropic.messages.create(params as any) as Promise<AiChatResponse>,
};

// ─── POST /api/uc/ai/water-chat ───────────────────────────────────────────────
router.post("/uc/ai/water-chat", async (req: Request, res: Response): Promise<void> => {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const userId = authenticatedUserId(req.headers["authorization"]);
  if (userId === null) {
    res.status(401).json({
      error: "Authentication required. Please log in to use the water quality assistant.",
    });
    return;
  }

  // ── Rate limit ──────────────────────────────────────────────────────────────
  if (isRateLimited(userId)) {
    res.status(429).json({
      error: "Too many requests. Please wait a moment before sending another message.",
    });
    return;
  }

  const { messages, filterContext, isRetry } = req.body as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    filterContext?: {
      productName?:   string;
      daysRemaining?: number;
      waterSource?:   string;
      lastCheckIn?:   string;
      cleanCount?:    number;
    };
    isRetry?: boolean;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") {
      res.status(400).json({ error: "Each message must have role 'user' or 'assistant'" });
      return;
    }
    if (typeof m.content !== "string" || m.content.trim().length === 0) {
      res.status(400).json({ error: "Each message must have non-empty string content" });
      return;
    }
  }

  if (messages[0]?.role !== "user") {
    res.status(400).json({ error: "First message must have role 'user'" });
    return;
  }

  // Build context preamble
  let contextPreamble = "";
  if (filterContext && Object.values(filterContext).some(v => v !== undefined)) {
    const parts: string[] = ["[Customer filter context]"];
    if (filterContext.productName)
      parts.push(`Product: ${filterContext.productName}`);
    if (filterContext.daysRemaining !== undefined)
      parts.push(filterContext.daysRemaining > 0
        ? `Cartridge days remaining: ${filterContext.daysRemaining}`
        : "Cartridge overdue for replacement");
    if (filterContext.waterSource) {
      const labels: Record<string, string> = {
        mains: "Nairobi NWSC mains", borehole: "borehole water",
        surface: "surface / rainwater", mixed: "mixed mains + borehole",
      };
      parts.push(`Water source: ${labels[filterContext.waterSource] ?? filterContext.waterSource}`);
    }
    if (filterContext.cleanCount !== undefined)
      parts.push(`Times filter cleaned: ${filterContext.cleanCount}`);
    if (filterContext.lastCheckIn)
      parts.push(`Last check-in result: ${filterContext.lastCheckIn}`);
    contextPreamble = parts.join(" | ");
  }

  // Retry note: injected when the customer rated the previous answer unhelpful
  const retryNote = isRetry
    ? "[COACHING NOTE: The customer found your previous answer unclear or unhelpful. " +
      "Please try a significantly different approach — simpler language, a concrete real-world example, " +
      "or ask one targeted clarifying question to better understand what they need. " +
      "Do not repeat the same explanation.]"
    : "";

  const anthropicMessages = messages.map((m, i) => {
    if (i === 0) {
      const prefix = [contextPreamble, retryNote].filter(Boolean).join("\n\n");
      return {
        role:    m.role as "user" | "assistant",
        content: prefix ? `${prefix}\n\nCustomer: ${m.content}` : m.content,
      };
    }
    return { role: m.role as "user" | "assistant", content: m.content };
  });

  try {
    const response = await _aiClient.create({
      model:      "claude-haiku-4-5",
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      messages:   anthropicMessages,
    });

    const rawText = (() => {
      const block = response.content.find((b: AiChatResponse["content"][number]) => b.type === "text");
      return block?.type === "text" ? (block.text ?? "") : "";
    })();

    const { reply, suggestions } = parseSuggestions(rawText);
    res.json({ reply, suggestions });
  } catch (err) {
    console.error("[uc/ai/water-chat] AI error:", err);
    res.status(502).json({
      error: "Alison is temporarily unavailable. Please try again shortly or contact support at 0717774049.",
    });
  }
});

// ─── POST /api/uc/ai/chat-feedback ───────────────────────────────────────────
// Stores customer thumbs up/down ratings in the database.
// Forms the knowledge base that the UCFilters team reviews to identify gaps
// in Alison's answers.
router.post("/uc/ai/chat-feedback", async (req: Request, res: Response): Promise<void> => {
  const { rating, question, answer } = req.body as {
    rating:   unknown;
    question: unknown;
    answer:   unknown;
  };

  if (rating !== "up" && rating !== "down") {
    res.status(400).json({ error: "rating must be 'up' or 'down'" });
    return;
  }
  if (typeof question !== "string" || typeof answer !== "string") {
    res.status(400).json({ error: "question and answer must be strings" });
    return;
  }

  try {
    await db.insert(ucAiFeedbackTable).values({
      rating:   rating as "up" | "down",
      question: question.slice(0, 500),
      answer:   answer.slice(0, 1000),
    });
  } catch (err) {
    console.error("[Alison feedback] DB insert failed:", err);
    res.status(500).json({ error: "Failed to save feedback" });
    return;
  }

  // Log low-rated answers so they surface in server logs for review
  if (rating === "down") {
    console.warn("[Alison feedback] Unhelpful answer flagged:", {
      question: question.slice(0, 120),
      answer:   answer.slice(0, 120),
    });
    // Bust the topics cache so the next GET /topics sees the new row immediately
    bustTopicsCache();
  }

  res.json({ ok: true });
});

// ─── Server-side keyword extraction (mirrors client stop-words exactly) ───────

const STOP_WORDS = new Set([
  // English function words
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','as','is','it','its','was','are','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should','may',
  'might','shall','can','that','this','these','those','i','you','he','she',
  'we','they','me','him','her','us','them','my','your','his','our','their',
  'what','which','who','when','where','why','how','all','any','both','each',
  'few','more','most','other','some','such','no','not','only','own','same',
  'so','than','too','very','just','about','above','after','before','between',
  'into','through','up','down','out','off','over','under','again','then',
  'once','if','because','while','although','since','until','also','though',
  // Common question / filler words
  'get','got','use','used','using','make','made','need','want','like','know',
  'think','go','going','comes','coming','put','see','work','works','working',
  'try','trying','give','gives','help','helps','tell','told','let','keep',
  'take','takes','still','already','even','much','many','good','long','new',
  'please','hi','hello','thanks','thank','ok','yes','no','sure',
  // Generic water / filter chat words that add no signal
  'water','filter','filters','alison','ultra','clear','ucfilters',
  'product','question','answer','issue','problem','time','day','days',
]);

function serverTokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((w: string) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter((w: string) => w.length >= 3 && !STOP_WORDS.has(w));
}

interface TopicSummary {
  keywords:    [string, number][];
  totalDown:   number;
  mostFlagged: { question: string; count: number } | null;
}

function computeTopics(questions: string[], topN = 12): TopicSummary {
  const freq = new Map<string, number>();
  for (const q of questions) {
    for (const w of serverTokenise(q)) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  // Most-repeated exact question (normalised)
  const qFreq = new Map<string, { original: string; count: number }>();
  for (const q of questions) {
    const key = q.trim().toLowerCase();
    if (!key) continue;
    const existing = qFreq.get(key);
    if (existing) existing.count++;
    else qFreq.set(key, { original: q, count: 1 });
  }
  let mostFlagged: { question: string; count: number } | null = null;
  for (const { original, count } of qFreq.values()) {
    if (count >= 2 && (!mostFlagged || count > mostFlagged.count)) {
      mostFlagged = { question: original, count };
    }
  }

  return { keywords, totalDown: questions.length, mostFlagged };
}

// ─── Topics cache ─────────────────────────────────────────────────────────────
// Cached for 5 minutes; busted whenever a thumbs-down rating is submitted.

const TOPICS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let topicsCache: { data: TopicSummary; expiresAt: number } | null = null;

/** Invalidate the topics cache (called after any thumbs-down submission). */
function bustTopicsCache(): void {
  topicsCache = null;
}

// ─── GET /api/uc/ai/chat-feedback/topics  (admin-only) ───────────────────────
// Returns server-computed keyword frequencies and the most-repeated question
// across ALL thumbs-down entries in the DB (no page cap).
// Results are cached in memory for 5 minutes; cache is invalidated on every
// new thumbs-down submission so the team never sees stale data after a review.
router.get("/uc/ai/chat-feedback/topics", async (req: Request, res: Response): Promise<void> => {
  if (!(await isAdminRequest(req.headers["authorization"]))) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  // ?force=1 lets an authenticated admin bypass a warm cache to trigger a fresh scan
  const forceRefresh = req.query["force"] === "1";

  // Return cached result if still fresh and no force-refresh requested
  if (!forceRefresh && topicsCache && Date.now() < topicsCache.expiresAt) {
    res.json(topicsCache.data);
    return;
  }

  try {
    const rows = await db
      .select({ question: ucAiFeedbackTable.question })
      .from(ucAiFeedbackTable)
      .where(eq(ucAiFeedbackTable.rating, "down"));

    const questions = rows.map(r => r.question);
    const result = computeTopics(questions);

    // Store in cache
    topicsCache = { data: result, expiresAt: Date.now() + TOPICS_CACHE_TTL_MS };

    res.json(result);
  } catch (err) {
    console.error("[Alison topics] DB read failed:", err);
    res.status(500).json({ error: "Failed to compute topics" });
  }
});

// ─── GET /api/uc/ai/chat-feedback  (admin-only review endpoint) ──────────────
// Protected: requires a valid admin JWT in the Authorization header.
// Query params:
//   rating=up|down  — filter by rating (omit for all)
//   keyword=<term>  — case-insensitive substring match on question text;
//                     when set, all matching rows are returned (no pagination)
//   limit=N         — max items per page (default 100, max 200; ignored when keyword set)
//   page=N          — 1-based page number (default 1; ignored when keyword set)
router.get("/uc/ai/chat-feedback", async (req: Request, res: Response): Promise<void> => {
  if (!(await isAdminRequest(req.headers["authorization"]))) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const ratingFilter = req.query["rating"] as string | undefined;
  const keywordRaw   = req.query["keyword"] as string | undefined;
  const keyword      = keywordRaw?.trim().slice(0, 100) || undefined; // sanitise; max 100 chars
  const limit  = Math.min(200, Math.max(1, parseInt(String(req.query["limit"] ?? "100"), 10) || 100));
  const page   = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10) || 1);
  const offset = (page - 1) * limit;

  try {
    // Build query — filter by rating and/or keyword when provided
    const ratingCond  = ratingFilter === "up" || ratingFilter === "down"
      ? eq(ucAiFeedbackTable.rating, ratingFilter)
      : undefined;
    const keywordCond = keyword
      ? ilike(ucAiFeedbackTable.question, `%${keyword}%`)
      : undefined;
    const baseWhere =
      ratingCond && keywordCond ? and(ratingCond, keywordCond)
      : ratingCond ?? keywordCond;

    const [items, allRows, weekRows] = await Promise.all([
      // When keyword is active return ALL matches (no pagination); otherwise paginate
      keyword
        ? db.select()
            .from(ucAiFeedbackTable)
            .where(baseWhere)
            .orderBy(desc(ucAiFeedbackTable.createdAt))
        : db.select()
            .from(ucAiFeedbackTable)
            .where(baseWhere)
            .orderBy(desc(ucAiFeedbackTable.createdAt))
            .limit(limit)
            .offset(offset),

      // Total count for the filtered set (rating filter only; keyword count is items.length)
      db.select({ id: ucAiFeedbackTable.id, rating: ucAiFeedbackTable.rating })
        .from(ucAiFeedbackTable)
        .where(ratingCond),

      // Last-7-day counts (no rating/keyword filter so stats are always full-picture)
      db.select({ id: ucAiFeedbackTable.id, rating: ucAiFeedbackTable.rating, createdAt: ucAiFeedbackTable.createdAt })
        .from(ucAiFeedbackTable)
        .where(undefined),
    ]);

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekEntries = weekRows.filter(e => new Date(e.createdAt) >= cutoff);
    const weekStats = {
      total: weekEntries.length,
      up:    weekEntries.filter(e => e.rating === "up").length,
      down:  weekEntries.filter(e => e.rating === "down").length,
    };

    // Normalise shape to match what the ProjectHub UI already expects
    const shaped = items.map(e => ({
      id:              e.id,
      ts:              e.createdAt.toISOString(),
      rating:          e.rating,
      question:        e.question,
      answer:          e.answer,
      improvementNote: e.improvementNote ?? null,
    }));

    res.json({
      totalInLog: allRows.length,
      weekStats,
      // When keyword is active, count = matched items; otherwise count = total in filtered set
      count:   keyword ? shaped.length : allRows.length,
      items:   shaped,
      keyword: keyword ?? null,
      page,
      limit,
    });
  } catch (err) {
    console.error("[Alison feedback] DB read failed:", err);
    res.status(500).json({ error: "Failed to fetch feedback" });
  }
});

// ─── CSV helpers (exported for unit tests) ────────────────────────────────────

/**
 * Escape and sanitise a single CSV cell value (RFC 4180 + formula-injection
 * defence).
 *
 * Spreadsheet formula injection defence: any value whose first non-whitespace
 * character is `=`, `+`, `-`, or `@` is prefixed with a literal apostrophe
 * (`'`) before the value — including any leading whitespace — so that
 * Excel and LibreOffice treat the entire cell as plain text rather than a
 * formula.  The apostrophe is a widely-supported text-prefix marker that is
 * preserved through CSV import and reliably prevents formula execution.
 *
 * Standard RFC 4180 quoting: a cell is wrapped in double-quotes when it
 * contains a comma, double-quote, newline, or carriage-return; any embedded
 * double-quote is doubled.  Cells that received a formula-injection prefix
 * are always wrapped in double-quotes to keep the output unambiguous.
 */
export function sanitiseCsvCell(value: string): string {
  const str = value ?? "";

  // Detect formula-injection trigger characters (first non-whitespace char).
  // Match even when there is leading whitespace so "  =cmd" is also caught.
  const needsFormulaPrefix = /^\s*[=+\-@]/.test(str);
  // Prefix the WHOLE value (including any leading whitespace) with an
  // apostrophe so the spreadsheet app sees `'<value>` and treats it as text.
  const safe = needsFormulaPrefix ? `'${str}` : str;

  // RFC 4180 quoting — always quote formula-prefixed cells for clarity
  if (
    needsFormulaPrefix ||
    safe.includes('"') ||
    safe.includes(',') ||
    safe.includes('\n') ||
    safe.includes('\r')
  ) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

// ─── PATCH /api/uc/ai/chat-feedback/:id/note  (admin-only) ───────────────────
// Save a team improvement suggestion on a feedback entry. Limited to 250
// characters (enforced here, mirrored by the UI). An empty note clears it.
router.patch("/uc/ai/chat-feedback/:id/note", async (req: Request, res: Response): Promise<void> => {
  if (!(await isAdminRequest(req.headers["authorization"]))) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid feedback id" });
    return;
  }

  const noteRaw = (req.body as { note?: unknown } | undefined)?.note;
  if (typeof noteRaw !== "string") {
    res.status(400).json({ error: "note must be a string" });
    return;
  }
  const note = noteRaw.trim();
  if (note.length > 250) {
    res.status(400).json({ error: "Improvement suggestion is limited to 250 characters" });
    return;
  }

  try {
    const [row] = await db
      .select({ id: ucAiFeedbackTable.id })
      .from(ucAiFeedbackTable)
      .where(eq(ucAiFeedbackTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Feedback entry not found" });
      return;
    }
    await db.update(ucAiFeedbackTable)
      .set({
        improvementNote:   note || null,
        improvementNoteAt: note ? new Date() : null,
      })
      .where(eq(ucAiFeedbackTable.id, id));
    res.json({ ok: true, id, note: note || null });
  } catch (err) {
    console.error("[Alison feedback] note update failed:", err);
    res.status(500).json({ error: "Failed to save suggestion" });
  }
});

// ─── GET /api/uc/ai/chat-feedback/export  (admin-only CSV download) ──────────
// Streams a CSV of the uc_ai_feedback table (ts, rating, question, answer)
// matching optional rating and date filters.
// Query params:
//   rating=up|down  — filter by rating (omit for all)
//   from=YYYY-MM-DD — include entries on or after this date (UTC)
//   to=YYYY-MM-DD   — include entries on or before this date (UTC, inclusive)
router.get("/uc/ai/chat-feedback/export", async (req: Request, res: Response): Promise<void> => {
  if (!(await isAdminRequest(req.headers["authorization"]))) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const ratingFilter = req.query["rating"] as string | undefined;
  const fromParam    = req.query["from"]   as string | undefined;
  const toParam      = req.query["to"]     as string | undefined;

  // Build where clauses
  const conditions: ReturnType<typeof eq>[] = [];
  if (ratingFilter === "up" || ratingFilter === "down") {
    conditions.push(eq(ucAiFeedbackTable.rating, ratingFilter));
  }
  if (fromParam) {
    const fromDate = new Date(`${fromParam}T00:00:00.000Z`);
    if (!isNaN(fromDate.getTime())) {
      conditions.push(gte(ucAiFeedbackTable.createdAt, fromDate));
    }
  }
  if (toParam) {
    const toDate = new Date(`${toParam}T23:59:59.999Z`);
    if (!isNaN(toDate.getTime())) {
      conditions.push(lte(ucAiFeedbackTable.createdAt, toDate));
    }
  }

  const whereClause = conditions.length === 0
    ? undefined
    : conditions.length === 1
      ? conditions[0]
      : and(...conditions as [ReturnType<typeof eq>, ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]);

  try {
    const rows = await db.select()
      .from(ucAiFeedbackTable)
      .where(whereClause)
      .orderBy(desc(ucAiFeedbackTable.createdAt));

    // Build file name: alison-feedback-YYYY-MM-DD.csv
    const dateStamp = new Date().toISOString().slice(0, 10);
    const fileName  = `alison-feedback-${dateStamp}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    // Write header row
    res.write("ts,rating,question,answer,improvement_note\r\n");

    // Write data rows
    for (const row of rows) {
      const line = [
        sanitiseCsvCell(row.createdAt.toISOString()),
        sanitiseCsvCell(row.rating),
        sanitiseCsvCell(row.question),
        sanitiseCsvCell(row.answer),
        sanitiseCsvCell(row.improvementNote ?? ""),
      ].join(",");
      res.write(`${line}\r\n`);
    }

    res.end();
  } catch (err) {
    console.error("[Alison feedback export] DB read failed:", err);
    // Only send error header if we haven't started writing yet
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to export feedback" });
    } else {
      res.end();
    }
  }
});

export default router;
