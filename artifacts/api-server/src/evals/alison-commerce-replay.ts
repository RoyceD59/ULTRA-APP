/** Unpaid replay of captured real-model replies through the production safeguard. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cases, checkReply } from "./alison-commerce-cases.js";
import { guardAlisonCommerceReply } from "../lib/alison-commerce-guard.js";
import type { AlisonCatalogue } from "../lib/alison-catalogue.js";

const directory = path.resolve("eval-results");
const files = (await readdir(directory)).filter(name => /^alison-commerce(?:-\d+)?\.json$/.test(name)).sort();
if (!files.length) throw new Error("No captured real-model reports found; opt in to the live evaluation first.");
const results = [];
for (const file of files) {
  const report = JSON.parse(await readFile(path.join(directory, file), "utf8"));
  if (!Array.isArray(report.results) || !report.results.length) throw new Error(`Empty or invalid report: ${file}`);
  for (const input of report.results) {
    const scenario = cases.find(c => c.name === input.case);
    if (!scenario || typeof input.system !== "string" || !Array.isArray(input.messages)) throw new Error(`Invalid captured case: ${file}`);
    const raw = input.rawReply ?? input.reply;
    if (typeof raw !== "string") throw new Error(`Missing captured reply: ${file}`);
    const output = guardAlisonCommerceReply({ messages: input.messages, knowledgeContext: input.system, rawReply: raw });
    const failures = checkReply(scenario, input.catalogue as AlisonCatalogue, output.rawReply);
    results.push({ source: file, case: input.case, round: input.round, rawReply: raw, deliveredReply: output.rawReply, guarded: output.guarded, failures });
  }
}
await writeFile(path.join(directory, "guard-replay.json"), JSON.stringify({
  evaluatedAt: new Date().toISOString(), paidCalls: 0, results,
}, null, 2) + "\n");
const failed = results.filter(r => r.failures.length > 0).length;
console.log(`${results.length - failed}/${results.length} captured real-model replies pass after the production safeguard; no model calls made.`);
if (failed) process.exitCode = 1;