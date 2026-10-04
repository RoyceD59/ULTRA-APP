# Team Library customer-knowledge approval

Extends the approved Alison design with an explicit staff publication boundary.
Existing and new uploads remain private by default. Active database-verified team
administrators may preview UTF-8 Markdown or plain text (32 KB input, 16,000
characters extracted), set a public source title, and confirm that the complete
text contains no customer records, personal data, confidential material, or
assistant instructions. Unsupported formats must be uploaded as reviewed text.

Extraction does not execute or render markup, fetch links, or load attachments.
It removes metadata, HTML, comments, image references and link destinations.
The preview is inert text; approval re-extracts and verifies the preview's content
hash. A compare-and-set revision prevents stale or concurrent approvals from
overwriting a revocation. Approved derived reference text is a snapshot, not file
bytes, and the original storage object's visibility is never changed.

Alison queries only approved source titles and text, with no private object
paths, uploader details, draft fields or customer records. Sources stay bounded,
ranked, and JSON-encoded as untrusted reference facts, not instructions. Retrieval
errors fail explicitly. Revocation clears the snapshot and excludes the reference
from subsequent lookups without a corpus cache. Deletion removes the row and
therefore its reference. Revocation cannot retract already sent or in-flight
answers. Review controls persist through reload and refresh across staff sessions.