# Alison commerce evaluation

Normal `pnpm test` never calls a paid model. The offline test covers the evaluator's
fixtures and rejection checks, not Alison's generated answers.

From `artifacts/api-server`, explicitly run:

```sh
pnpm eval:alison-commerce --live
# Optional: 1–5 rounds per scenario; default is 2 (18 requests).
pnpm eval:alison-commerce --live --rounds=1
```

This uses the existing Anthropic integration and production model, prompt and
output limit. It makes paid calls; requests are sequential with rate-limit
backoff. No real customer data, database writes or live store calls are used.
The real catalogue loader is first warmed with synthetic old data; after its
60-second TTL expires, controlled Woo adapters provide new IDs/prices, an
outage, removed credentials, unknown currency, quote-only pricing, out-of-stock,
backorder, unknown stock or a variable parent price. Production knowledge
rendering supplies stale reference text as well as current catalogue facts.
Every conversation also contains an earlier assistant's obsolete commerce facts.

The paid evaluator retains both the untouched model answer (`rawReply`,
`rawFailures`, `rawPassed`) and the customer-facing answer after the shared
production commerce safeguard (`reply`, `failures`, `passed`, `guarded`).
Do not describe safe delivered replies as proof that the model itself obeyed.

## Response safeguard

Genuine price, stock and fulfillment requests or generated store-fact assertions
route the reply to deterministic commerce rendering. No model commerce prose or
model suggestions survive that path. Installation sequence, cleaning, returns
and recommendations do not become store-fact requests simply because they
mention an order or include a product link. Link-only guidance keeps its prose,
with product links checked against current authority; unverified links are
removed with a short explanation. Unsafe suggestion chips are replaced without
discarding ordinary guidance.
Only this turn's validated live block supplies identity, amount, currency,
price kind and stock. Unknown data stays explicitly unknown; no delivery
promise or stock quantity is supplied. An absent/ambiguous product match does
not prove the product is missing from the store: ask for the exact name or
direct the customer to the Shop/support without guessing an identity.

Ordinary water-use and maintenance guidance remains model-generated. Mixed
safety/purchase questions retain a professional-water-test disclaimer.
Duplicate HTTP turns and concurrent historical writers also pass through the
guard before delivery; original transcript history is not commerce authority.
The routing is conservative English/commerce-language detection, not a
universal semantic classifier for every language or paraphrase.

Replay all retained real-model answers without any paid calls:

```sh
pnpm eval:alison-commerce:replay
```

The replay writes `eval-results/guard-replay.json`, keeping its source report
identities and untouched raw answers. Offline guard tests also cover invalid
blocks, ambiguous products, stale IDs, unsafe suggestions, exact decimal
formatting and unmodified non-commerce guidance.

`eval-results/alison-commerce-<timestamp>.json` retains complete synthetic inputs, model
identity, prompt hash, response identifiers, token usage, raw replies and
deterministic check failures. Nonzero exit means a failed check, incomplete
reply or provider failure; a provider failure is never a successful evaluation.
Review raw replies too: phrase-based checks are conservative and cannot prove
every possible semantic contradiction. Preserve reports for comparisons when
changing the prompt/model; rerun explicitly, never add this to ordinary CI.

A finite passing evaluation is regression evidence, not a guarantee that an AI
will never make a future error, nor a check of actual deployed store freshness.