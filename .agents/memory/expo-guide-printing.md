---
name: Expo guide printing
description: Cross-platform printing constraint for complete customer-facing article exports.
---

On web, Expo Print ignores its HTML argument and prints the current browser document. Article exports must use a separate complete print document rather than the interactive screen.

**Why:** Guide screens collapse most sections by default. Printing the screen would omit installation steps and safety warnings, and include app navigation instead of a clean guide.

**How to apply:** Preserve the complete displayed guide snapshot in the export, including every section regardless of expansion state. Use Expo Print for native PDF generation and an isolated HTML document for browser printing. Do not assume passing HTML to Expo Print makes web and native behave the same way.