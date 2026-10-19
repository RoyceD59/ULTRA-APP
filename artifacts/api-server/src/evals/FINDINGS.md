# Real-model commerce findings

The production `claude-haiku-4-5` model was evaluated with nine controlled
scenarios, twice per run, using production prompt and knowledge rendering.
Each scenario warms the real loader with obsolete synthetic Woo data, expires
the cache, and supplies changed facts or a lookup failure. Earlier assistant
history and approved reference text both contain old commerce claims.
No real customer data or store changes were used.

Four initial explicitly opted-in runs were performed while tightening the prompt.
The full synthetic input and raw output evidence is retained in `eval-results/`:

| Report | Checks passed | What it showed |
| --- | --- | --- |
| `alison-commerce.json` | 7/18 | Historical links reused; historical KES attached to a new amount despite unknown currency; unknown stock described as available. Some checks also rejected safe omissions or conditional future-restock wording. |
| `alison-commerce-1791094398207.json` | 14/18 | Explicit repeated currency rules still did not stop inferred KES. Some out-of-stock replies omitted a link. |
| `alison-commerce-1791094485509.json` | 16/18 | Withholding currency-less amounts and explicitly identifying unknown currency fixed those cases. Manual review additionally found unsupported parent-price classification of simple products. |
| `alison-commerce-1791094606527.json` | 15/18 | Latest prompt: changed price/ID, outage, removed credentials, unknown currency, out-of-stock, backorder and variable-price cases passed in both rounds. Two substantive failures remain, plus one omitted requested link. |

Check criteria evolved alongside manual review. The counts are not an
apples-to-apples accuracy benchmark; use the raw replies to distinguish model
errors from conservative evaluator failures.

## Remaining substantive failures in the last prompt-only run

- Unknown stock, first round: “[Sweet Home](product:9842) is available to order”
  immediately followed by “Current stock status cannot be verified”.
- Quote-only simple product, first round: after saying no price was supplied,
  it added “If Sweet Home has variants, the price shown is the listed parent
  price”. Neither a price nor a variable-product classification was supplied.
- Quote-only, second round: no requested live product link. This is an
  incomplete answer, not an invented commerce fact.

The final report's check failures correctly flag these cases. No failed run
was converted to a pass or retried selectively until successful. Normal unit
tests remain unpaid and only test fixtures, prompt plumbing and rejection checks.

## Conclusion

Current prompt instructions are **not enough to confirm “never”**. Do not
represent the evaluation as passing or guaranteeing all future replies.
Further prompt-only iteration was stopped. A separate response-validation
decision is needed to block unverified commerce assertions before delivery;
that behavior change was subsequently approved by the user, as recorded below.

## Approved safeguard and final evaluation

After the user approved response safeguards, commerce-bearing replies were
changed to deterministic rendering from the current verified catalogue block.
The model's commerce prose and suggestions are not delivered. Non-commerce
water/maintenance guidance remains model-generated. Stored-answer replays and
concurrent historical writers also pass through the safeguard before delivery.

The new explicitly opted-in real-model run is retained in
`eval-results/alison-commerce-1791107366193.json`:

- **18/18 customer-facing replies passed**, across all nine scenarios twice.
- **17/18 untouched model replies passed** the deterministic checks. The model
  still described unknown stock as available to order in one response; the
  delivered answer correctly said current stock availability could not be
  verified. Raw failures remain visible in the report.
- **90/90 retained real-model answers passed** when replayed through the shared
  production safeguard with their original catalogue contexts and customer
  messages. This replay made no paid calls; its evidence is in
  `eval-results/guard-replay.json`.
- API typecheck and **69 focused Alison tests passed**, including HTTP replies,
  stored safe answers, outage replays, concurrent historical writers and
  unmodified non-commerce guidance.

The completion review exposed over-broad routing in the initial safeguard:
installation order, cleaning/recommendations containing valid product links,
and after-sales returns were being replaced with commerce boilerplate. The
routing was narrowed to actual store-fact requests/assertions. Link-only
guidance now keeps its prose while current IDs/names are verified; obsolete
links are removed without discarding the guidance. Unsafe suggestion chips
are replaced independently. All four reproduced flows now have offline and
HTTP delivery/persistence/replay coverage. The 90-answer unpaid replay still
passes with this final routing.

These results verify the controlled cases and the applied safeguard, not
universal model obedience or a guarantee for every language/paraphrase.
Commerce routing is deliberately conservative; broad multilingual and
unusual-phrasing coverage remains a separate evaluation concern. Catalogue
freshness follows the existing short-lived loader cache.

The prompt improvements are local workspace changes, not evidence that a
published deployment has been updated.