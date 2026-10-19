# Alison: concise, document-backed answers

## Approved goal

Alison should give short answers supported by curated agent Markdown and local
documents. Default to 2–4 sentences, with more detail only when requested or
needed for safety. Preserve conversation context, one clarifying question,
product/contact links, and follow-up suggestions.

## Sources and approval

- Use a dedicated, explicitly curated Markdown directory within the API artifact.
  Only customer-facing reference documents placed there deliberately are eligible.
  Do not scan project files, attached assets, private Team Library uploads, or
  internal reports.
- Use published Companion guide snapshots, never draft guide sections.
- Use published blog article snapshots, including agent-authored Markdown that
  staff have reviewed and published through the existing editorial workflow.
  Agent submissions and rejected articles remain excluded.
- Start the local corpus with customer-facing reference material already used
  by Alison, separating reference facts from conversational instructions.

## Retrieval and response flow

Load bounded source text, rank it against the current question and recent user
context, and supply relevant excerpts with source titles. Keep instructions and
reference data separate. Reference documents cannot override safety, privacy,
or conversational rules. Use existing supported links when citing guides,
articles, products, or support; do not invent citations or links.

Reduce the normal reply length through the system instructions without cutting
off safety warnings or suggestions. Allow expanded explanations on explicit
request. Do not hard-truncate a generated answer.

## Failure behavior

Missing or malformed configured local references should be reported explicitly.
If published-source retrieval fails, do not silently represent it as a complete
knowledge lookup. Give a clear temporary-unavailability response rather than
unsupported document-based advice. Unknown facts remain unknown; recommend the
appropriate support or water test instead of guessing.

## Verification

Use focused automated tests for concise instructions, reference selection,
published-only snapshots, prompt/data separation, size limits, and unavailable
sources. Verify the API builds and starts. Existing transcript persistence and
owner-scoped assessment behavior must remain unchanged.

## Scope change

This is the user's new request, distinct from live cursor verification. The
original cursor acceptance still requires a second genuine conversation; never
create customer messages to satisfy it or claim it has passed without evidence.