# Alison implementation plan

1. Extract existing customer reference facts into allowlisted local Markdown.
   Copy those assets into the API build so production uses the same corpus.
2. Add bounded, relevance-ranked retrieval from local Markdown and published
   guide/article snapshots. Exclude private uploads and drafts; keep reference
   text separate from instructions and fail explicitly on retrieval errors.
3. Update Alison's prompt for 2–4-sentence default replies, optional detail,
   source attribution, and unchanged safety/product/contact/suggestion behavior.
4. Test source approval, relevance, size limits, failure behavior, and route
   integration in the isolated API test database; typecheck and restart the API.
5. Recheck the original live pagination requirement without generating messages.
   Report its actual status separately from the user-approved scope change.