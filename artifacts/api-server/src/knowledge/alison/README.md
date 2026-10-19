# Curating Alison's local documents

Only Markdown files listed in `manifest.json` are used by Alison. This README,
unlisted files, attached assets and private Team Library uploads are not sources.

To include a local or agent-prepared customer reference:

1. Review it for factual accuracy, privacy and customer suitability.
2. Add a UTF-8 `.md` file here (maximum 32 KiB), using clear section headings.
3. Add its filename and customer-facing title to `manifest.json` (maximum 16 sources).
4. Build/restart the API; its build copies this directory into `dist/knowledge/alison`.

Do not include secrets, private customer records, instructions for the AI, or
unsupported health/contaminant-removal claims. Markdown is reference data, not
permission to override Alison's safety rules.

Agent-authored articles already have a staff-review workflow: submit as an
editorial draft, review and publish in ProjectHub. Only the published snapshot
is eligible. Published Companion guides are eligible through their existing
guide editor; edits to drafts are never used.

Retrieval selects relevant excerpts rather than sending every document. Local
catalogue prices are reference values, not live WooCommerce prices.