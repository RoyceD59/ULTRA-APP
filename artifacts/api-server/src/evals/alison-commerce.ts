/**
 * Paid, explicit opt-in only. Not a *.test.ts file and never imported by normal tests.
 * No customer data, writes, live Woo access or HTTP server needed.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { cases, checkReply, prepareCase } from "./alison-commerce-cases.js";
import { ALISON_MODEL, ALISON_MAX_TOKENS, SYSTEM_PROMPT } from "../lib/alison-prompt.js";
import { guardAlisonCommerceReply } from "../lib/alison-commerce-guard.js";

const args = process.argv.slice(2);
if (!args.includes("--live")) {
  console.error("No model calls made. Opt in with: pnpm eval:alison-commerce --live [--rounds=2]");
  process.exit(2);
}
if (args.some(a => a !== "--live" && !/^--rounds=[1-5]$/.test(a))) {
  console.error("Accepted flags: --live and --rounds=1..5");
  process.exit(2);
}
const rounds = Number(args.find(a => a.startsWith("--rounds="))?.split("=")[1] ?? 2);
// Import only after opt-in; missing flags must not even initialize the paid client.
const { anthropic } = await import("@workspace/integrations-anthropic-ai");
const { batchProcess } = await import("@workspace/integrations-anthropic-ai/batch");
const report = {
  evaluatedAt: new Date().toISOString(), model: ALISON_MODEL, maxTokens: ALISON_MAX_TOKENS,
  promptSha256: createHash("sha256").update(SYSTEM_PROMPT).digest("hex"), rounds,
  note: "Synthetic controlled Woo transitions; real model replies. Finite evidence, not a guarantee of all future responses. Inspect full replies for semantic contradictions.",
  results: [] as Array<Record<string, unknown>>,
};
const output = path.resolve(`eval-results/alison-commerce-${Date.now()}.json`);
await mkdir(path.dirname(output), { recursive: true });
console.log(`Opted in: ${rounds * cases.length} real ${ALISON_MODEL} requests; sequential, rate-limit backoff enabled.`);
// Persist every completed case, including failures; provider errors fail the run, never become passes.
const jobs = Array.from({ length: rounds }, (_, round) => cases.map(scenario => ({ round: round + 1, scenario }))).flat();
await batchProcess(jobs, async ({ round, scenario }) => {
  const fixture = await prepareCase(scenario);
  const response = await anthropic.messages.create({
    model: ALISON_MODEL, max_tokens: ALISON_MAX_TOKENS,
    system: fixture.system, messages: fixture.messages,
  }, { timeout: 60_000 });
  const raw = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const rawFailures = checkReply(scenario, fixture.catalogue, raw);
  if (response.stop_reason !== "end_turn") rawFailures.push(`incomplete model answer: ${response.stop_reason}`);
  const guarded = guardAlisonCommerceReply({ messages: fixture.messages, knowledgeContext: fixture.system, rawReply: raw });
  const failures = checkReply(scenario, fixture.catalogue, guarded.rawReply);
  if (!guarded.guarded && response.stop_reason !== "end_turn") failures.push(`incomplete delivered answer: ${response.stop_reason}`);
  report.results.push({
    case: scenario.name, round, passed: failures.length === 0, failures,
    before: fixture.before, catalogue: fixture.catalogue,
    messages: fixture.messages, system: fixture.system, reply: guarded.rawReply,
    rawReply: raw, rawFailures, rawPassed: rawFailures.length === 0, guarded: guarded.guarded,
    responseId: response.id, stopReason: response.stop_reason, usage: response.usage,
  });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`${failures.length ? "FAIL" : "PASS"} ${scenario.name} round ${round}${failures.length ? `: ${failures.join("; ")}` : ""}`);
  // Limit request starts as well as concurrency; batch utility retries rate limits with backoff.
  await new Promise(resolve => setTimeout(resolve, 1000));
}, { concurrency: 1, retries: 3, minTimeout: 2000, maxTimeout: 15000 });
const failed = report.results.filter(r => !r.passed).length;
console.log(`${report.results.length - failed}/${report.results.length} passed. Full synthetic inputs and replies: ${output}`);
if (failed) process.exitCode = 1;