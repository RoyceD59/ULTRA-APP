---
name: Alison answer policy
description: User-approved brevity and curated-document scope for Alison.
---

Alison should give shorter answers backed by agent-provided Markdown and local
documents. The user approved short replies and curated documents, not arbitrary
project-file access.

**Why:** The user found Alison too verbose and asked for document-backed knowledge.

**How to apply:** Prefer concise answers; use only customer-facing curated sources.
Do not treat private internal documents or unreviewed agent content as approved.

Product identity, prices, currency and stock must come from verified live
WooCommerce data, not local reference Markdown or the public shop's demo fallback.
On lookup failure, keep approved guidance available but do not reuse expired
catalogue facts.

**Why:** Historical references included placeholder product IDs and prices that
can look authoritative even when the store has changed.

**How to apply:** Keep live commerce facts separate from curated product-use and
maintenance guidance; explicitly mark unknown fields and store unavailability.

Real-model evaluation is necessary for commerce prompt changes. Generic
precedence rules and repeated prohibitions were not enough: the production
Haiku model attached historical KES to a new amount with unknown currency,
reused historical links, and called unknown stock available to order.
Withholding unquotable numeric prices at the prompt boundary fixed the observed
currency cases, but prompt-only stock restrictions still produced contradictions.

**Why:** Stubbed chat tests verify prompt construction, not model compliance.
Multiple controlled real-model runs exposed failures despite explicit rules.

**How to apply:** Keep paid evaluations explicitly opt-in, retain full synthetic
inputs and replies, and manually inspect semantic claims as well as automated
checks. Do not promise that a prompt-only solution guarantees commerce accuracy;
the user approved a response safeguard after prompt-only checks still failed.

Commerce-bearing replies should use deterministic current facts rather than
trusting arbitrary model prose. Ordinary water-use and maintenance guidance
remains model-generated. Historic transcripts stay intact, but replayed commerce
must use the current turn's verified authority, not a stored old answer.

**Why:** The user explicitly approved safeguards when real-model replies still
invented availability and parent-price classifications despite stronger prompts.

**How to apply:** Apply the same safeguard in production, evaluations and replay
paths. Keep raw model failures separate from safe delivered replies in reports;
do not claim that guarded success means the model itself followed the rules.

Guard actual store-fact requests/assertions, not every occurrence of “order”
or a product link. Installation sequence, linked cleaning instructions,
document-backed recommendations and empathetic returns guidance must survive.
Validate current product links independently and remove unverifiable links
without discarding the guidance.

**Why:** Broad routing based on those generic signals replaced legitimate
installation, maintenance, recommendation and returns answers with price/stock
boilerplate. Commerce-only evaluation questions did not reveal that regression.

**How to apply:** Include these guidance flows in offline and HTTP regression
checks whenever commerce routing changes; handle unsafe suggestion chips
separately from the useful main answer.

Team Library approval is permission to use reviewed public reference text, not
permission to publish the uploaded file. The original remains private; customer
retrieval must not acquire object URLs, uploader details, or customer records.
Revocation stops future retrieval; it cannot erase prior or in-flight answers.

**Why:** The requested upload review workflow extends Alison's curated-public
scope without opening the private Team Library to customers.

**How to apply:** Keep the public-text approval boundary separate from storage
visibility, and require a new review before replacing approved reference text.

PDF manual support is text-only, not OCR or permission to publish images,
attachments or originals. Scanned and mixed image-only pages require staff to
provide reviewed text instead of approving a partial extraction.

**Why:** The approved extension is bounded inert text extraction, not automatic
interpretation of scanned manuals or diagrams.

**How to apply:** Do not add OCR, image interpretation or Word conversion as an
implicit fallback; treat those as separate scope requiring approval.
